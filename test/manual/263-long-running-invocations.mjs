// 显式运行：node --test test/manual/263-long-running-invocations.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import Ajv from "ajv";
import {
  assertRuntimeLimits,
  assertContextEnvelope,
  InvokeInput,
  failurePayload
} from "@mininglamp-oss/octo-runtime-protocol";
import { AgentExecutor, prepareInvokeInput } from "@mininglamp-oss/octo-runtime-executor-core";
import {
  InvocationWatchdog,
  normalizeRuntimeLimits
} from "../../packages/octo-runtime-executor-core/dist/watchdog.js";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";
import { build, batch } from "../../native/tests/driver.mjs";
import { adapter } from "./263-long-running-adapter.mjs";
import { createDshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";

const DAY = 86_400_000;
const MAX = 7 * DAY;
const context = (payload) => ({
  schema: "octo.context-envelope/v3",
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "long-budget" } },
    ...(payload === undefined ? [] : [{ namespace: "octo.execution", name: "limits", payload }])
  ]
});
const input = (fields = {}) => ({
  inputs: [{ type: "text", text: "test" }],
  approvalMode: "full_access",
  contexts: context(),
  protocol_mode: "canonical",
  ...fields
});
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function clockFixture(limits = {}) {
  let now = 0;
  const timers = new Map();
  const controller = new AbortController();
  const records = [];
  const clock = {
    now: () => now,
    schedule(fn, delay) {
      const key = Symbol();
      timers.set(key, { fn, at: now + delay });
      return () => timers.delete(key);
    }
  };
  const watchdog = new InvocationWatchdog(limits, controller, (r) => records.push(r), clock);
  return {
    watchdog,
    controller,
    timers,
    records,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > end) break;
        now = first[1].at;
        timers.delete(first[0]);
        first[1].fn();
      }
      now = end;
    },
    jump(ms) {
      now += ms;
    }
  };
}

test("A1: schema and TS boundaries agree on both budget representations", async () => {
  const schema = JSON.parse(
    await readFile("packages/octo-runtime-protocol/schema/protocol.schema.json")
  );
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema, "protocol");
  const nativeCases = [];
  for (const value of [100, DAY, 3 * DAY, MAX, 99, MAX + 1, 0, -1, 100.5, "259200000", null]) {
    const valid =
      typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= MAX;
    for (const [definition, data, check] of [
      ["RuntimeLimits", { runTimeoutMs: value }, assertRuntimeLimits],
      ["ContextEnvelope", context({ run_timeout_ms: value }), assertContextEnvelope],
      ["InvokeInputWire", input({ runtimeLimits: { runTimeoutMs: value } }), InvokeInput.check]
    ]) {
      const validate = ajv.getSchema(`protocol#/definitions/${definition}`);
      assert.ok(validate, definition);
      assert.equal(validate(data), valid, `${definition}: ${value}`);
      if (valid) assert.doesNotThrow(() => check(data));
      else assert.throws(() => check(data));
      nativeCases.push({ op: "codec", definition, value: data, valid });
    }
  }
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertRuntimeLimits({ runTimeoutMs: value }));
    assert.throws(() => assertContextEnvelope(context({ run_timeout_ms: value })));
  }
  // Native 只公开 Context/InvokeInput 模型；RuntimeLimits 通过 InvokeInputWire 间接覆盖。
  const cases = nativeCases.filter((c) => c.definition !== "RuntimeLimits");
  await mkdir(".tmp", { recursive: true });
  for (const language of ["go", "python"]) {
    build(language);
    const results = await batch(language, cases);
    results.forEach((result, i) => assert.equal(result.valid, cases[i].valid, `${language}: ${i}`));
  }
});

test("A2: defaults, whole-object precedence and caller snapshot", () => {
  for (const [fields, budget] of [
    [{}, DAY],
    [{ runtimeLimits: {} }, DAY],
    [{ runtimeLimits: { toolTimeoutMs: 500 } }, DAY],
    [{ contexts: context({ tool_timeout_ms: 500 }) }, DAY],
    [{ contexts: context({ run_timeout_ms: 3 * DAY }) }, 3 * DAY],
    [{ runtimeLimits: { runTimeoutMs: MAX } }, MAX],
    [{ runtimeLimits: { runTimeoutMs: 100 } }, 100],
    [{ contexts: context({ run_timeout_ms: MAX, tool_timeout_ms: 700 }), runtimeLimits: {} }, DAY],
    [
      { contexts: context({ run_timeout_ms: MAX }), runtimeLimits: { runTimeoutMs: 3 * DAY } },
      3 * DAY
    ]
  ]) {
    const value = input(fields),
      before = structuredClone(value);
    const request = prepareInvokeInput(value).request;
    assert.equal(normalizeRuntimeLimits(request.runtimeLimits).runTimeoutMs, budget);
    assert.deepEqual(value, before);
  }
});

for (const budget of [DAY, 3 * DAY, MAX])
  for (const kind of ["model", "tool"])
    test(`A4/A5: healthy ${kind} progresses until exact ${budget}ms deadline`, () => {
      const f = clockFixture(budget === DAY ? {} : { runTimeoutMs: budget });
      if (kind === "model") f.watchdog.activity({ kind: "turn_started", method: "turn_start" });
      else f.watchdog.canonical(event("tool_call.create", { id: "tool" }));
      for (let elapsed = 0; elapsed < budget - 1;) {
        const step = Math.min(60_000, budget - 1 - elapsed);
        f.tick(step);
        elapsed += step;
        assert.equal(f.controller.signal.aborted, false, `at ${elapsed}`);
        f.watchdog.activity({
          kind: "turn_progress",
          method: kind === "model" ? "text_delta" : "tool_delta",
          ...(kind === "tool" ? { toolCallId: "tool" } : {})
        });
      }
      f.tick(1);
      assert.equal(f.controller.signal.reason.timeoutReason, "run_deadline");
      assert.equal(f.controller.signal.reason.evidence.elapsedMs, budget);
      assert.equal(f.records.filter((r) => r.event === "timeout").length, 1);
      assert.equal(f.timers.size, 0);
    });

test("A5/A6: short deadline, independent stall, observe and approval policies", () => {
  for (const [phase, reason] of [
    ["starting", "first_frame"],
    ["model", "model_silence"],
    ["tool", "tool_idle"]
  ]) {
    const f = clockFixture({
      runTimeoutMs: MAX,
      firstFrameTimeoutMs: 100,
      modelIdleTimeoutMs: 100,
      toolTimeoutMs: 100
    });
    if (phase === "model") f.watchdog.activity({ kind: "turn_started", method: "turn_start" });
    if (phase === "tool") f.watchdog.canonical(event("tool_call.create", { id: "tool" }));
    f.tick(99);
    assert.equal(f.controller.signal.aborted, false);
    f.tick(1);
    assert.equal(f.controller.signal.reason.timeoutReason, reason);
  }
  for (const limits of [
    { runTimeoutMs: 100, modelIdlePolicy: "observe" },
    { runTimeoutMs: 100, modelIdleTimeoutMs: 100 }
  ]) {
    const f = clockFixture(limits);
    f.watchdog.activity({ kind: "turn_started", method: "turn_start" });
    f.tick(100);
    assert.equal(f.controller.signal.reason.timeoutReason, "run_deadline");
  }
  const waiting = clockFixture({ runTimeoutMs: MAX });
  waiting.watchdog.interaction("approval", true);
  waiting.tick(MAX - 1);
  assert.equal(waiting.controller.signal.aborted, false);
  waiting.tick(1);
  assert.equal(waiting.controller.signal.reason.timeoutReason, "run_deadline");
  const observe = clockFixture({ runTimeoutMs: 100, enforcement: "observe" });
  observe.tick(MAX + 1);
  assert.equal(observe.controller.signal.aborted, false);
  observe.watchdog.dispose();
});

test("A7/A9: late diagnostics and explicit long-state cancellation release timers", () => {
  const f = clockFixture({ runTimeoutMs: MAX });
  f.watchdog.interaction("approval", true);
  f.jump(MAX + 5000);
  f.watchdog.interaction("approval", false);
  const error = f.controller.signal.reason;
  const payload = failurePayload(
    {
      code: "ADAPTER_RUN_DEADLINE",
      timeoutStage: error.timeoutStage,
      timeoutMs: error.timeoutMs,
      timeoutReason: error.timeoutReason,
      watchdog: { ...error.evidence, openToolCount: MAX, secret: "private" }
    },
    { stage: "adapter.invoke", defaultDomain: "adapter" }
  );
  assert.equal(payload.failure.code, "OH-ADP-3011");
  assert.equal(payload.failure.params.timeoutMs, MAX);
  assert.equal(payload.failure.params.elapsedMs, MAX + 5000);
  assert.equal(payload.failure.params.openToolCount, undefined);
  assert.equal(payload.failure.params.secret, undefined);
  const g = clockFixture({ runTimeoutMs: MAX });
  g.watchdog.interaction("approval", true);
  g.tick(3 * DAY + 1);
  g.controller.abort(new Error("explicit cancel"));
  assert.equal(g.timers.size, 0);
  g.watchdog.dispose();
});

test("A3/A7: real public Kernel IPC preserves long budgets and supports cancel/close", async (t) => {
  const f = await kernelFixture(t, {
    manifest: resolve("test/manual/263-long-running-adapters.json")
  });
  const startsFile = resolve(f.directory, "starts.txt");
  for (const budget of [3 * DAY, MAX])
    for (const viaContext of [false, true]) {
      const value = input(
        viaContext
          ? { contexts: context({ run_timeout_ms: budget }) }
          : { runtimeLimits: { runTimeoutMs: budget } }
      );
      value.runMetadata = { startsFile };
      const events = await Array.fromAsync(f.client.invoke(value));
      assert.equal(
        JSON.parse(events.find((e) => e.type === "message.delta").payload.text).runTimeoutMs,
        budget
      );
      assert.equal(events.at(-1).type, "run.completed");
    }
  const startsBefore = await readFile(startsFile, "utf8");
  for (const fields of [
    { runtimeLimits: { runTimeoutMs: MAX + 1 } },
    { contexts: context({ run_timeout_ms: MAX + 1 }) }
  ]) {
    await assert.rejects(
      Array.fromAsync(f.client.invoke(input({ ...fields, runMetadata: { startsFile } })))
    );
    assert.equal(await readFile(startsFile, "utf8"), startsBefore);
  }
  const controller = new AbortController();
  const values = [];
  await assert.rejects(
    (async () => {
      for await (const value of f.client.invoke(
        input({ inputs: [{ type: "text", text: "wait" }], runtimeLimits: { runTimeoutMs: MAX } }),
        { signal: controller.signal }
      )) {
        values.push(value);
        if (value.type === "message.delta") controller.abort(new Error("explicit cancel"));
      }
    })(),
    /explicit cancel/
  );
  assert.equal(values.at(-1).type, "run.cancelled");
  const iterator = f.client.invoke(
    input({ inputs: [{ type: "text", text: "wait" }], runtimeLimits: { runTimeoutMs: MAX } })
  );
  while ((await iterator.next()).value.type !== "message.delta") {}
  const tail = Array.fromAsync(iterator);
  const result = await f.server.close();
  assert.equal(result.complete, true);
  // close 期间观察可能收到取消终态或服务关闭错误；资源回收由 service.close 的实际结果确认。
  await tail.catch((error) => assert.match(error.message, /KERNEL|CLIENT|RUN|STREAM/));
});

test("A7: direct Core shutdown releases an active seven-day invocation", async () => {
  const executor = new AgentExecutor();
  executor.register(adapter);
  const iterator = executor.invoke(
    input({ inputs: [{ type: "text", text: "wait" }], runtimeLimits: { runTimeoutMs: MAX } })
  );
  while ((await iterator.next()).value.type !== "message.delta") {}
  const tail = Array.fromAsync(iterator);
  const result = await executor.shutdown();
  assert.equal(result.cleanup, "complete");
  assert.equal((await tail).at(-1).type, "run.cancelled");
});

test("A8: unmodified DSH SDK schedules full budgets and Adapter forwards them", async (t) => {
  const require = createRequire(
    new URL("../../packages/octo-runtime-adapter-dsh/package.json", import.meta.url)
  );
  const { HarnessClient } = await import(
    pathToFileURL(require.resolve("@deepseek-ai/dsh-sdk-client"))
  );
  const original = HarnessClient.prototype.request;
  const waits = [],
    timers = [];
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    const timer = schedule(callback, ms, ...args);
    if ([DAY, 3 * DAY, MAX].includes(ms))
      timers.push({ requested: ms, scheduled: timer._idleTimeout, timer });
    return timer;
  });
  t.mock.method(HarnessClient.prototype, "request", function (method, params, timeout) {
    if (method === "session/wait") waits.push(timeout);
    return original.call(this, method, params, timeout);
  });
  for (const budget of [undefined, 3 * DAY, MAX]) {
    const request = invokeRequest({
      workdir: process.cwd(),
      approvalMode: "full_access",
      runtimeLimits: budget === undefined ? undefined : { runTimeoutMs: budget },
      agentConfig: {
        providerOptions: {
          dshBin: fileURLToPath(new URL("../fixtures/dsh-runtime.mjs", import.meta.url))
        }
      }
    });
    const events = await Array.fromAsync(createDshAdapter().invoke(request));
    assert.equal(events.at(-1).type, "run.completed", JSON.stringify(events.at(-1)));
  }
  assert.deepEqual(waits, [DAY, 3 * DAY, MAX]);
  for (const ms of waits)
    assert.ok(
      timers.some(
        (timer) => timer.requested === ms && timer.scheduled === ms && timer.timer._destroyed
      )
    );
});
