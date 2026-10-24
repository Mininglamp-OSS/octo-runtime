"""通用 JSON 原语；规则表由 Schema 编译生成，不加载 Schema 文件。"""

from __future__ import annotations
import json
import math
import re
from decimal import Decimal
from urllib.parse import urlsplit
from .generated_rules import RULES, DEFINITIONS


class KernelError(Exception):
    def __init__(self, code: str, data=None, *, remote=False):
        super().__init__(code)
        self.code, self.data, self.remote = code, data, remote


UNSET = object()


def normalize(value):
    """复制 JSON 容器并移除 UNSET 字段；显式 null、零值及 opaque 数字保持原义。"""

    def visit(v):
        if isinstance(v, dict):
            return {k: visit(x) for k, x in v.items() if x is not UNSET}
        if isinstance(v, list):
            return [visit(x) for x in v]
        return v

    try:
        return visit(value)
    except RecursionError as e:
        raise KernelError("INVALID_JSON") from e


def dumps(value) -> bytes:
    def encode(v):
        if v is None:
            return "null"
        if v is True:
            return "true"
        if v is False:
            return "false"
        if isinstance(v, str):
            if any(0xD800 <= ord(c) <= 0xDFFF for c in v):
                raise KernelError("INVALID_JSON_UNICODE")
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        if isinstance(v, (int, Decimal)):
            if isinstance(v, Decimal) and not v.is_finite():
                raise KernelError("INVALID_JSON_NUMBER")
            return str(v)
        if isinstance(v, float):
            if not math.isfinite(v):
                raise KernelError("INVALID_JSON_NUMBER")
            return repr(v)
        if isinstance(v, (list, tuple)):
            return "[" + ",".join(encode(x) for x in v) + "]"
        if isinstance(v, dict):
            if any(not isinstance(k, str) for k in v):
                raise KernelError("INVALID_JSON_KEY")
            return (
                "{"
                + ",".join(
                    encode(k) + ":" + encode(x) for k, x in v.items() if x is not UNSET
                )
                + "}"
            )
        raise KernelError("INVALID_JSON_VALUE")

    try:
        return encode(value).encode("utf-8")
    except (RecursionError, UnicodeError) as e:
        raise KernelError("INVALID_JSON") from e


def loads(data: bytes):
    def constant(_):
        raise KernelError("INVALID_JSON_NUMBER")

    try:
        value = json.loads(
            data.decode("utf-8", errors="strict"),
            parse_float=Decimal,
            parse_constant=constant,
        )
        dumps(value)  # 校验解码产生的孤立 surrogate，而不是替换非法字符串。
        return value
    except (ValueError, UnicodeError, RecursionError) as e:
        raise KernelError("INVALID_JSON") from e


def validate(definition: str, value):
    # 返回独立 JSON 容器，让 identity 默认值和后续 deepcopy 都只处理真正存在的字段。
    value = normalize(value)
    dumps(value)
    check(DEFINITIONS[definition], value)
    return value


def decode(definition: str, data: bytes):
    return validate(definition, loads(data))


def encode(definition: str, value) -> bytes:
    return dumps(validate(definition, value))


def check(index, value, path="$"):
    r = RULES[index]

    def bad():
        raise KernelError("VALIDATION_ERROR", {"path": path})

    def number(v):
        return isinstance(v, (int, Decimal, float)) and not isinstance(v, bool)

    def equal(a, b):
        if isinstance(a, bool) != isinstance(b, bool):
            return False
        return a == b

    def matches(i):
        try:
            check(i, value, path)
            return True
        except KernelError:
            return False

    if "ref" in r:
        return check(r["ref"], value, path)
    if "type" in r:
        types = r["type"] if isinstance(r["type"], list) else [r["type"]]
        predicates = {
            "null": value is None,
            "boolean": isinstance(value, bool),
            "string": isinstance(value, str),
            "array": isinstance(value, list),
            "object": isinstance(value, dict),
            "number": number(value),
            "integer": number(value) and value == int(value),
        }
        if not any(predicates[t] for t in types):
            bad()
    if "const" in r and not equal(value, r["const"]):
        bad()
    if "enum" in r and not any(equal(value, x) for x in r["enum"]):
        bad()
    if number(value):
        if "minimum" in r and value < r["minimum"]:
            bad()
        if "maximum" in r and value > r["maximum"]:
            bad()
    if isinstance(value, str):
        if len(value) < r.get("minLength", 0) or len(value) > r.get(
            "maxLength", math.inf
        ):
            bad()
        if "pattern" in r and re.search(r["pattern"], value) is None:
            bad()
    if isinstance(value, dict):
        if len(value) < r.get("minProperties", 0) or len(value) > r.get(
            "maxProperties", math.inf
        ):
            bad()
        if any(k not in value for k in r.get("required", [])):
            bad()
        for k, v in value.items():
            if "propertyNames" in r:
                check(r["propertyNames"], k, path)
            if k in r.get("properties", {}):
                check(r["properties"][k], v, path + "." + k)
            elif r.get("strict"):
                bad()
            elif "additionalProperties" in r:
                check(r["additionalProperties"], v, path + "." + k)
    if isinstance(value, list):
        if len(value) < r.get("minItems", 0) or len(value) > r.get(
            "maxItems", math.inf
        ):
            bad()
        if "items" in r:
            for i, v in enumerate(value):
                check(r["items"], v, f"{path}[{i}]")
        if r.get("uniqueItems") and any(
            equal(value[i], value[j]) for i in range(len(value)) for j in range(i)
        ):
            bad()
        if "contains" in r:
            found = False
            for v in value:
                try:
                    check(r["contains"], v, path)
                    found = True
                    break
                except KernelError:
                    pass
            if not found:
                bad()
    for i in r.get("allOf", []):
        check(i, value, path)
    if "oneOf" in r and sum(matches(i) for i in r["oneOf"]) != 1:
        bad()
    if "anyOf" in r and not any(matches(i) for i in r["anyOf"]):
        bad()
    if "not" in r and matches(r["not"]):
        bad()
    if "if" in r:
        branch = "then" if matches(r["if"]) else "else"
        if branch in r:
            check(r[branch], value, path)
    for extension, limit in r.get("extensions", {}).items():
        if extension == "x-octo-unicode-scalar-strings":
            pass  # validated at the codec boundary
        elif extension == "x-octo-max-json-bytes":
            if len(dumps(value)) > limit:
                bad()
        elif extension == "x-octo-max-json-depth":

            def depth(v):
                return (
                    1
                    + max(
                        (depth(x) for x in (v.values() if isinstance(v, dict) else v)),
                        default=0,
                    )
                    if isinstance(v, (list, dict)) and v
                    else 0
                )

            if depth(value) > limit:
                bad()
        elif extension == "x-octo-max-utf8-bytes":
            if isinstance(value, str) and len(value.encode("utf-8")) > limit:
                bad()
        elif extension == "x-octo-max-utf16-length":
            if isinstance(value, str) and len(value.encode("utf-16-le")) // 2 > limit:
                bad()
        elif extension == "x-octo-http-url":
            if isinstance(value, str):
                try:
                    u = urlsplit(value)
                    if (
                        u.scheme not in ("http", "https")
                        or not u.hostname
                        or u.username is not None
                        or any(c.isspace() for c in u.hostname)
                    ):
                        bad()
                    # urlsplit 只拆分 authority；读取 port 才校验格式及 0..65535。
                    _ = u.port
                except ValueError:
                    bad()
        elif extension == "x-octo-unique-header-names":
            if len({k.lower() for k in value}) != len(value):
                bad()
        elif extension in (
            "x-octo-unique-type-keys",
            "x-octo-unique-env-keys",
            "x-octo-unique-resource-refs",
        ):
            field, keys = {
                "x-octo-unique-type-keys": ("items", ["namespace", "name"]),
                "x-octo-unique-env-keys": ("env_variables", ["key"]),
                "x-octo-unique-resource-refs": ("entries", ["resource_ref"]),
            }[extension]
            a = value[field]
            if len({tuple(x[k] for k in keys) for x in a}) != len(a):
                bad()
        elif extension == "x-octo-matching-trigger-fields":
            fact = value["trigger_fact"]
            if (
                value["trigger_message_id"] != fact["message_id"]
                or ("trigger_seq" in value) != ("message_seq" in fact)
                or value.get("trigger_seq") != fact.get("message_seq")
            ):
                bad()
        elif extension == "x-octo-runtime-selection-invariants":
            a = value["authorized_candidates"]
            ids = {x["runtime_id"] for x in a}
            priorities = {x["priority"] for x in a}
            if len(ids) != len(a) or len(priorities) != len(a):
                bad()
            if value["selection_mode"] == "explicit":
                if (
                    len(a) != 1
                    or value.get("explicit_runtime_id") not in ids
                    or value["failover"] != "none"
                ):
                    bad()
            elif "explicit_runtime_id" in value:
                bad()
        else:
            raise RuntimeError("unsupported compiled refinement " + extension)
