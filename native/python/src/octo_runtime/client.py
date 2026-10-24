from __future__ import annotations
import asyncio
import copy
import uuid
from contextlib import suppress
from .codec import KernelError, dumps, loads, validate, check, normalize
from .generated_rules import BEHAVIOR as B, METHODS
from .generated_rpc import RPCMethods
from .transport import Transport


class CancelToken:
    """显式执行取消；Task.cancel/迭代器 aclose 只结束观察。"""

    def __init__(self):
        self.event = asyncio.Event()
        self.reason = "caller_aborted"

    def cancel(self, reason="caller_aborted"):
        self.reason = reason
        self.event.set()

    @property
    def cancelled(self):
        return self.event.is_set()

    def check(self):
        if self.cancelled:
            raise KernelError("CALLER_ABORTED", {"reason": self.reason})


def identity(actual, expected, full=False):
    if (
        "kernel_instance_id" in expected
        and actual.get("kernel_instance_id") != expected["kernel_instance_id"]
    ):
        raise KernelError("KERNEL_INSTANCE_CHANGED")
    if any(
        actual.get(k) != expected.get(k)
        for k in B["receiptFields" if full else "lookupFields"]
    ):
        raise KernelError("RUN_IDENTITY_MISMATCH")


def terminal(frame):
    if (
        frame
        and frame.get("kind") == "control"
        and frame["control"]["type"] == "state"
        and frame["control"]["state"] in B["terminalStates"]
    ):
        return frame["control"]["state"]
    return None


def identify(input):
    request = validate("InvokeInputWire", input)
    for k in ("runId", "invocationId", "sessionId"):
        request.setdefault(k, str(uuid.uuid4()))
    for k, v in B["defaults"].items():
        request.setdefault(B["identityInputFields"][k], v)
    return request


def lookup(input):
    return {k: input[v] for k, v in B["identityInputFields"].items()}


def response(value, id):
    if (
        not isinstance(value, dict)
        or value.get("jsonrpc") != "2.0"
        or value.get("id") != id
        or ("result" in value) == ("error" in value)
    ):
        raise KernelError("INVALID_RESPONSE")
    try:
        validate(
            "IpcErrorResponse" if "error" in value else "IpcSuccessResponse", value
        )
    except KernelError as e:
        raise KernelError("INVALID_RESPONSE") from e
    if "error" in value:
        data = value["error"]["data"]
        raise KernelError(data["code"], data, remote=True)
    return value["result"]


class Client(RPCMethods):
    """附着已有 Kernel。调用方先停止接纳并 drain，最后 close 本 client 的资源。"""

    topology = "kernel-ipc"
    ownership = "attached"

    def __init__(self, endpoint):
        self.transport = Transport(endpoint)
        self.records = {}
        self.stopped = False
        self.controls = asyncio.Semaphore(B["limits"]["controlConcurrency"])
        self.background = set()
        self._draining = None
        self._drain_deadline = None
        self._control_timeouts = set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()

    def _task(self, coro):
        task = asyncio.create_task(coro)
        self.background.add(task)

        def finish(t):
            self.background.discard(t)
            if not t.cancelled():
                t.exception()  # 保存结果的 registry 持有 task；避免无人读取的异常告警。

        task.add_done_callback(finish)
        return task

    async def close(self):
        """停止本 client 的观察和控制 IO；不会向 Kernel 新发执行取消，也不确认远端终态。"""
        self.stop_admission()
        await self.transport.close()
        # 关闭观察或控制请求，不向 Kernel 发送新的取消动作。
        for task in list(self.background):
            task.cancel()
        await asyncio.gather(*list(self.background), return_exceptions=True)

    async def _rpc(self, method, params, before_write=None, timeout=None):
        # 先统一缺省字段，再校验与编码；写出后副作用结果不明时禁止自动重发。
        rule = METHODS[method]
        params = normalize(params)
        check(rule["params"], params)
        id = str(uuid.uuid4())
        line = (
            dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
            + b"\n"
        )
        if len(line) > B["limits"]["requestBytes"]:
            raise KernelError("INVOKE_REQUEST_TOO_LARGE")
        conn = None
        sent = False
        try:
            async with asyncio.timeout(
                timeout
                or B["timeoutsMs"][
                    "invokeAck" if method == "agent_run.invoke" else "unary"
                ]
                / 1000
            ):
                conn = await self.transport.open()
                if before_write:
                    before_write()
                sent = True
                await conn.write(line)
                result = response(loads(await conn.line()), id)
                try:
                    check(rule["result"], result)
                except KernelError as e:
                    raise KernelError("INVALID_RESPONSE") from e
                return result
        except (TimeoutError, OSError, KernelError) as e:
            if (
                sent
                and rule["side_effect"]
                and method != "agent_run.invoke"
                and not (isinstance(e, KernelError) and e.remote)
            ):
                raise KernelError("OPERATION_OUTCOME_UNKNOWN") from e
            if isinstance(e, TimeoutError):
                raise KernelError("KERNEL_TIMEOUT") from e
            if isinstance(e, OSError):
                raise KernelError("CONNECTION_CLOSED") from e
            raise
        finally:
            if conn:
                await conn.close()

    async def status(self):
        return await self.rpc_status({})

    async def list(self):
        return await self.rpc_list({})

    async def get(self, key, expected_instance=None):
        key = {k: key[k] for k in B["lookupFields"]}
        params = {"key": key}
        if expected_instance is not None:
            params["kernel_instance_id"] = expected_instance
        result = await self.rpc_get(params)
        identity(
            result["ref"],
            {
                **key,
                **(
                    {"kernel_instance_id": expected_instance}
                    if expected_instance is not None
                    else {}
                ),
            },
        )
        if "terminal" in result:
            self._frame_identity(result["terminal"], result["ref"])
            if not terminal(result["terminal"]):
                raise KernelError("HOST_FRAME_INVALID")
        self._reconcile(result)
        return result

    def _frame_identity(self, frame, ref):
        if any(frame.get(k) != ref[k] for k in B["receiptFields"]):
            raise KernelError("RUN_IDENTITY_MISMATCH")

    async def cancel(self, ref, reason=None):
        """高级原语：按原完整 ref 取消；ACK 仅表示受理，结果未知时不得自动重发。"""
        return await self.rpc_cancel(
            {"ref": ref, **({"reason": reason} if reason is not None else {})}
        )

    async def respond(self, ref, response):
        return await self.rpc_respond({"ref": ref, "response": response})

    async def respond_native(self, ref, response):
        return await self.rpc_respond_native({"ref": ref, "response": response})

    async def submit(self, input, environment=None, *, cancel_token=None):
        """高级原语：返回原 RunRef，不进入 invoke 登记；调用方负责订阅、取消及后续收尾。"""
        task = self._task(self._submit(input, environment or {}, cancel_token, None))
        # 用户 Task.cancel 不撤回已写出的接纳；内部 admission 仍有界地落到 accepted/unknown。
        return await asyncio.shield(task)

    async def _submit(self, input, environment, token, record):
        if token:
            token.check()
        environment = normalize(environment)
        if "streamLimits" in environment:
            raise KernelError("KERNEL_STREAM_LIMITS_UNSUPPORTED")
        validate("KernelInvokeEnvironmentWire", environment)
        request = identify(input)
        key = lookup(request)
        status = await self.status()
        instance = status["kernel_instance_id"]
        if token:
            token.check()
        if record is not None:
            record["instance"] = instance
        sent = False

        def before_write():
            nonlocal sent
            if token:
                token.check()
            if record is not None and self.stopped:
                raise KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED")
            sent = True
            if record is not None:
                record["submitted"] = True

        try:
            result = await self._rpc(
                "agent_run.invoke",
                {"input": request, **environment, "kernel_instance_id": instance},
                before_write,
            )
            ref = {
                **result["receipt"],
                "kernel_instance_id": result["kernel_instance_id"],
            }
            identity(ref, {**key, "kernel_instance_id": instance})
        except (KernelError, OSError) as e:
            if not sent or (
                isinstance(e, KernelError)
                and (
                    e.remote
                    or e.code in ("KERNEL_INSTANCE_CHANGED", "RUN_IDENTITY_MISMATCH")
                )
            ):
                raise
            ref = None
            try:
                # ACK 丢失后只查询同一身份；修复耗尽保留 unknown，绝不能重新 invoke。
                async with asyncio.timeout(B["timeoutsMs"]["recovery"] / 1000):
                    for delay in B["repairDelaysMs"]:
                        await asyncio.sleep(delay / 1000)
                        try:
                            ref = (await self.get(key, instance))["ref"]
                            break
                        except KernelError as q:
                            if q.code in (
                                "KERNEL_INSTANCE_CHANGED",
                                "RUN_IDENTITY_MISMATCH",
                            ):
                                raise
            except TimeoutError:
                pass
            if ref is None:
                raise KernelError("ACCEPTANCE_UNKNOWN") from e
        if record is None and token and token.cancelled:
            await self.cancel(ref, token.reason)
        return ref

    async def subscribe(self, ref, after_seq=0):
        """从最后连续序号拉取原执行；关闭迭代仅停止观察，断流修复不创建新的执行。"""
        ref = validate("KernelRunRef", ref)
        after = after_seq
        repair = 0
        until = None
        while True:
            conn = None
            try:
                budget = B["timeoutsMs"]["unary"] / 1000
                if until is not None:
                    budget = min(budget, until - asyncio.get_running_loop().time())
                    if budget <= 0:
                        raise KernelError("KERNEL_UNAVAILABLE")
                async with asyncio.timeout(budget):
                    params = {"ref": ref, "after_seq": after}
                    check(METHODS["agent_run.subscribe"]["params"], params)
                    conn = await self.transport.open()
                    id = str(uuid.uuid4())
                    await conn.write(
                        dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": id,
                                "method": "agent_run.subscribe",
                                "params": params,
                            }
                        )
                        + b"\n"
                    )
                    snapshot = response(loads(await conn.line()), id)
                    validate("KernelRunSnapshot", snapshot)
                    identity(snapshot["ref"], ref, True)
                    if "terminal" in snapshot:
                        self._frame_identity(snapshot["terminal"], ref)
                        if not terminal(snapshot["terminal"]):
                            raise KernelError("HOST_FRAME_INVALID")
                        self._reconcile(snapshot)
                        if after >= snapshot["latest_seq"]:
                            return
                while True:
                    notice = loads(await conn.line())
                    if (
                        isinstance(notice, dict)
                        and notice.get("method") == "agent_run.stream_error"
                    ):
                        validate("IpcStreamErrorNotification", notice)
                        if (
                            notice["params"]["kernel_instance_id"]
                            != ref["kernel_instance_id"]
                        ):
                            raise KernelError("KERNEL_INSTANCE_CHANGED")
                        raise KernelError(notice["params"]["code"])
                    validate("IpcEventNotification", notice)
                    p = notice["params"]
                    if p["kernel_instance_id"] != ref["kernel_instance_id"]:
                        raise KernelError("KERNEL_INSTANCE_CHANGED")
                    if (
                        p["run_id"] != ref["run_id"]
                        or p["stream_id"] != ref["stream_id"]
                    ):
                        raise KernelError("RUN_IDENTITY_MISMATCH")
                    frame = p["event"]
                    self._frame_identity(frame, ref)
                    if p["seq"] != frame["seq"] or frame["seq"] != after + 1:
                        raise KernelError("STREAM_GAP")
                    after = frame["seq"]
                    self._observe(ref, frame)
                    yield frame
                    if terminal(frame):
                        return
            except (KernelError, TimeoutError, OSError) as e:
                if self.transport.closed:
                    raise KernelError("CLIENT_CLOSED") from e
                if isinstance(e, KernelError) and e.code not in B["retryableErrors"]:
                    raise
                if repair >= len(B["repairDelaysMs"]):
                    raise KernelError("KERNEL_UNAVAILABLE") from e
                if until is None:
                    until = (
                        asyncio.get_running_loop().time()
                        + B["timeoutsMs"]["recovery"] / 1000
                    )
                delay = B["repairDelaysMs"][repair] / 1000
                repair += 1
                if asyncio.get_running_loop().time() + delay >= until:
                    raise KernelError("KERNEL_UNAVAILABLE") from e
                if conn:
                    await conn.close()
                    conn = None
                await asyncio.sleep(delay)
            finally:
                if conn:
                    await conn.close()

    async def invoke(
        self, input, environment=None, *, cancel_token=None, deadline=None
    ):
        """首次迭代登记并接纳；native 返回 HostFrame，canonical 返回其事件。

        显式 token/绝对 deadline 请求执行取消并保留尾流；aclose/Task.cancel 只停止观察。
        接纳和已触发控制由 client 持有，未知执行保留登记，owner 通过 drain 完成收尾。
        """
        if cancel_token:
            cancel_token.check()
        request = identify(input)
        r = self._begin(lookup(request))
        token = cancel_token or CancelToken()
        watcher = None
        source = None
        deadline_task = None

        async def expire():
            await asyncio.sleep(max(0, deadline - asyncio.get_running_loop().time()))
            token.cancel("deadline_exceeded")

        async def watch():
            await token.event.wait()
            # 一旦用户取消，接纳等待与控制归 client 所有，观察退出不能撤销它。
            await asyncio.shield(self._task(self._cancel_record(r, token.reason)))

        async def admit():
            try:
                ref = await self._submit(request, environment or {}, token, r)
                r["ref"] = ref
                r["phase"] = "accepted" if r["observing"] else "unobserved"
                r["admitted"].set()
                return ref
            except BaseException as e:
                r["admission_error"] = e
                r["phase"] = "acceptance_unknown"
                r["observationError"] = getattr(e, "code", "ACCEPTANCE_UNKNOWN")
                r["admitted"].set()
                if not r["submitted"] or (
                    isinstance(e, KernelError)
                    and e.remote
                    and e.code
                    not in ("RUN_IDENTITY_MISMATCH", "KERNEL_INSTANCE_CHANGED")
                ):
                    self.records.pop(r["key"]["invocation_id"], None)
                raise

        if deadline is not None:
            deadline_task = asyncio.create_task(expire())
        watcher = asyncio.create_task(watch())
        try:
            ref = await asyncio.shield(self._task(admit()))
            source = self.subscribe(ref)
            async for frame in source:
                state = terminal(frame)
                if request["protocol_mode"] == "canonical":
                    if frame["kind"] == "canonical":
                        yield frame["event"]
                    elif frame["kind"] == "control":
                        control = frame["control"]
                        if control["type"] == "gap":
                            raise KernelError("STREAM_GAP")
                        if control["type"] == "error":
                            try:
                                snapshot = await self.get(
                                    r["key"], ref["kernel_instance_id"]
                                )
                            except KernelError:
                                snapshot = {}
                            if terminal(snapshot.get("terminal")) == "lost":
                                raise KernelError("RUN_OUTCOME_UNKNOWN")
                            raise KernelError(control["code"], control)
                else:
                    yield frame
                if state == "lost":
                    raise KernelError("RUN_OUTCOME_UNKNOWN")
            if r["cancel_task"] is not None:
                await asyncio.shield(r["cancel_task"])
            if token.cancelled:
                token.check()
        except BaseException as e:
            r["observationError"] = getattr(e, "code", "OBSERVATION_STOPPED")
            raise
        finally:
            r["observing"] = False
            # token 与观察关闭可在同一轮调度发生；watcher 尚未运行也须保留意图。
            if token.cancelled and r["cancellation"] == "none":
                self._task(self._cancel_record(r, token.reason))
            if source:
                await source.aclose()
            for task in (watcher, deadline_task):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError, KernelError):
                        await task
            if r["ref"] is not None and r["key"]["invocation_id"] in self.records:
                r["phase"] = "unobserved"

    def _begin(self, key):
        if self.stopped:
            raise KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED")
        id = key["invocation_id"]
        if id in self.records:
            raise KernelError("EXECUTION_IDENTITY_CONFLICT")
        if len(self.records) >= B["limits"]["invocations"]:
            raise KernelError("CLIENT_INVOCATION_CAPACITY_EXHAUSTED")
        r = {
            "key": key,
            "ref": None,
            "phase": "admitting",
            "cancellation": "none",
            "lastSeq": 0,
            "instance": None,
            "submitted": False,
            "observing": True,
            "admitted": asyncio.Event(),
            "admission_error": None,
            "cancel_task": None,
            "reason": None,
        }
        self.records[id] = r
        return r

    def invocations(self):
        return copy.deepcopy(
            [
                {
                    k: r[k]
                    for k in (
                        "key",
                        "ref",
                        "phase",
                        "cancellation",
                        "lastSeq",
                        "observationError",
                    )
                    if k in r and r[k] is not None
                }
                for r in self.records.values()
            ]
        )

    def stop_admission(self):
        self.stopped = True

    def _observe(self, ref, frame):
        r = self.records.get(ref["invocation_id"])
        if r is None or r["ref"] != ref:
            return
        r["lastSeq"] = max(r["lastSeq"], frame["seq"])
        state = terminal(frame)
        if state == "lost":
            r["phase"] = "unobserved"
            r["observationError"] = "RUN_OUTCOME_UNKNOWN"
        elif state:
            self.records.pop(ref["invocation_id"], None)

    def _reconcile(self, snapshot):
        ref = snapshot["ref"]
        r = self.records.get(ref["invocation_id"])
        if r is None or (
            r["instance"] is not None and r["instance"] != ref["kernel_instance_id"]
        ):
            return
        identity(ref, r["key"])
        if r["ref"] is not None:
            identity(ref, r["ref"], True)
        r["ref"] = ref
        r["instance"] = ref["kernel_instance_id"]
        r["admitted"].set()
        if "terminal" in snapshot:
            self._observe(ref, snapshot["terminal"])

    def _record(self, id):
        if id not in self.records:
            raise KernelError("INVOCATION_NOT_TRACKED")
        return self.records[id]

    def _ref(self, id):
        r = self._record(id)
        if r["ref"] is None:
            raise KernelError("INVOCATION_NOT_ACCEPTED")
        return r["ref"]

    async def cancel_invocation(self, id, reason="caller_cancelled"):
        return await self._cancel_record(self._record(id), reason)

    async def respond_interaction(self, id, response):
        return await self.respond(self._ref(id), response)

    async def respond_native_interaction(self, id, response):
        return await self.respond_native(self._ref(id), response)

    async def _cancel_record(self, r, reason):
        if r["reason"] is None:
            r["reason"] = reason
        if r["cancellation"] == "none":
            r["cancellation"] = "requested"

        async def control():
            try:
                # 任务归 client 所有；观察关闭不撤销它。首次 drain 同时约束接纳等待、排队及在途 IO。
                async with asyncio.timeout_at(self._drain_deadline) as budget:
                    self._control_timeouts.add(budget)
                    try:
                        await r["admitted"].wait()
                        if r["ref"] is None:
                            raise r["admission_error"] or KernelError(
                                "ACCEPTANCE_UNKNOWN"
                            )
                        if r.get("observationError") == "RUN_OUTCOME_UNKNOWN":
                            raise KernelError("RUN_OUTCOME_UNKNOWN")
                        if r["key"]["invocation_id"] not in self.records:
                            return {"accepted": False}
                        async with self.controls:
                            if (
                                self._drain_deadline is not None
                                and asyncio.get_running_loop().time()
                                >= self._drain_deadline
                            ):
                                raise TimeoutError
                            result = await self.cancel(r["ref"], r["reason"])
                    finally:
                        self._control_timeouts.discard(budget)
                r["cancellation"] = "acknowledged"
                return result
            except TimeoutError as e:
                # 取消 ACK 未确认不等于执行已取消；保留登记供调用方处理 unresolved。
                r["cancellation"] = "unknown"
                raise KernelError("DRAIN_DEADLINE_EXCEEDED") from e
            except BaseException:
                r["cancellation"] = "unknown"
                raise

        if r["cancel_task"] is None:
            r["cancel_task"] = self._task(control())
        return await asyncio.shield(r["cancel_task"])

    async def drain(self, *, deadline, reason="owner_shutdown"):
        """用事件循环的绝对时间排空；重复调用共享首次结果，只有确认终态才释放登记。"""
        self.stop_admission()

        async def run():
            sem = asyncio.Semaphore(B["limits"]["lookupConcurrency"])

            async def reconcile(r):
                async with sem:
                    if r["instance"] is None:
                        return
                    try:
                        snapshot = await self.get(r["key"], r["instance"])
                        if not terminal(snapshot.get("terminal")):
                            await self._cancel_record(r, reason)
                    except KernelError:
                        pass

            try:
                async with asyncio.timeout_at(deadline):
                    while self.records:
                        await asyncio.gather(
                            *(reconcile(r) for r in list(self.records.values()))
                        )
                        if self.records:
                            await asyncio.sleep(0.1)
            except TimeoutError:
                pass
            return {"complete": not self.records, "unresolved": self.invocations()}

        if self._draining is None:
            self._drain_deadline = deadline
            # 收紧此前已启动的控制任务，不能只给 drain 新建任务设置 timeout。
            for budget in self._control_timeouts:
                budget.reschedule(deadline)
            self._draining = self._task(run())
        return await asyncio.shield(self._draining)
