import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build, batch } from "./driver.mjs";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
const read = async (name) =>
  JSON.parse(
    await readFile(
      new URL("../../packages/octo-runtime-protocol/schema/" + name, import.meta.url),
      "utf8"
    )
  );
const cases = [];
for (const c of await read("native-invoke-fixtures.json")) {
  let valid = true;
  try {
    InvokeInput.check(c.value);
  } catch {
    valid = false;
  }
  assert.equal(valid, c.valid, `TS InvokeInput reference: ${c.name}`);
  cases.push({ ...c, definition: "InvokeInputWire" });
}
// 同时经过 TS 权威边界与三语言 codec，避免只验证某个 URL parser 的宽松行为。
for (const [url, valid] of [
  ["http://example.com:bad/path", false],
  ["http://exa mple.com/path", false],
  ["http://example.com:70000/path", false],
  ["http://example.com:-1/path", false],
  ["http://example.com:65535/path", true],
  ["http://example.com:0/path", true],
  ["http://[::1]:8080/path", true],
  ["https://example.com/path?q=a%20b", true]
]) {
  const value = {
    inputs: [{ type: "text", text: "test" }],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "mcp",
          payload: { mcpServers: { example: { type: "streamable_http", url } } }
        }
      ]
    }
  };
  let tsValid = true;
  try {
    InvokeInput.check(value);
  } catch {
    tsValid = false;
  }
  assert.equal(tsValid, valid, `TS MCP URL reference: ${url}`);
  cases.push({ name: `MCP URL ${url}`, definition: "InvokeInputWire", value, valid });
}
for (const c of await read("context-fixtures.json")) {
  const [key, definition] = c.context
    ? ["context", "ContextEnvelope"]
    : c.resolved_execution_plan
      ? ["resolved_execution_plan", "ResolvedExecutionPlan"]
      : [];
  if (key) cases.push({ name: c.name, definition, value: c[key], valid: c.valid });
}
for (const c of await read("runtime-selection-fixtures.json"))
  cases.push({
    name: c.name,
    definition: "ResolvedRuntimeSelection",
    value: c.selection,
    valid: c.valid
  });
const run = await read("run-protocol-fixtures.json");
for (const valid of [true, false])
  for (const [definition, values] of Object.entries(run[valid ? "valid" : "invalid"]))
    for (const [valueIndex, value] of values.entries())
      cases.push({ name: definition + "/" + valid + "/" + valueIndex, definition, value, valid });
for (const c of (await read("kernel-ipc-fixtures.json")).cases)
  cases.push({ name: c.name, definition: "IpcRequest", value: c.request, valid: c.valid });
test(`${language} shared authoritative protocol fixtures (${cases.length})`, async () => {
  build(language);
  const results = await batch(
    language,
    cases.map((c) => ({ op: "codec", definition: c.definition, value: c.value }))
  );
  const failures = [];
  for (const [i, c] of cases.entries()) {
    if (
      (results[i].valid ??
        (["INVALID_JSON", "INVALID_JSON_UNICODE"].includes(results[i].error)
          ? false
          : undefined)) !== c.valid
    )
      failures.push({ name: c.name, want: c.valid, result: results[i] });
  }
  assert.deepEqual(failures, []);
});
