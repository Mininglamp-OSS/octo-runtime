import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { AdapterHost, spawnAdapterHost } from "@mininglamp-oss/octo-runtime-adapter-host";
import { assertHostFrame, isHostTerminal } from "@mininglamp-oss/octo-runtime-protocol";
import { createExecutorFixture } from "../test-support/executor-adapter.mjs";
import { deferred } from "./runtime-fixture.js";

const collect = async (source) => Array.fromAsync(source);
const input = (id = "one", mode = "native", text = "answer") => ({
  inputs: [{ type: "text", text }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "adapter", payload: { type: "executor-fixture" } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
      { namespace: "extra.executor", name: "background", payload: { text: "current context" } }
    ]
  },
  protocol_mode: mode,
  invocationId: `invoke-${id}`,
  runId: `run-${id}`,
  sessionId: "session-one"
});
const executor = (t, invoke) => {
  const core = new AgentExecutor();
  const adapter = createExecutorFixture();
  core.register(invoke ? { ...adapter, invoke } : adapter);
  t.after(() => core.shutdown());
  return core;
};
const raw = { kind: "native", messageKind: "notification", payload: { exact: true } };

test("public Core is the only execution class and has no transport or process setup", async () => {
  assert.equal(AdapterHost, AgentExecutor);
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtExceptionMonitor"];
  const before = signals.map((name) => process.listenerCount(name));
  const core = new AgentExecutor();
  assert.deepEqual(core.list(), []);
  assert.deepEqual(
    signals.map((name) => process.listenerCount(name)),
    before
  );
  const directory = new URL("../packages/octo-runtime-executor-core/src/", import.meta.url);
  for (const name of await readdir(directory)) {
    const source = await readFile(new URL(name, directory), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*octo-runtime-(?:adapter-host|daemon|extra-)/);
    assert.doesNotMatch(source, /from\s+["']node:(?:net|child_process)["']/);
  }
  assert.equal((await core.shutdown()).cleanup, "complete");
});

for (const mode of ["native", "canonical"]) {
  test(`${mode}: receipt owns cancellation before Provider starts`, async (t) => {
    let calls = 0;
    const core = executor(t, async function* () {
      calls++;
    });
    const source = core.invokeFrames(input(mode, mode));
    const first = await source.next();
    assert.equal(first.value.control.state, "running");
    assert.equal(core.cancel(`invoke-${mode}`), true);
    assert.equal(core.cancel(`invoke-${mode}`), false);
    const rest = await collect(source);
    assert.equal(calls, 0);
    assert.equal(rest.at(-1).control.state, "cancelled");
    assert.equal(rest.filter(isHostTerminal).length, 1);
    for (const frame of rest) {
      assertHostFrame(frame);
      assert.equal(frame.stream_id, first.value.stream_id);
    }
  });
}

test("invalid policies are rejected without reserving identities or calling the Adapter", async (t) => {
  let calls = 0;
  const fixture = createExecutorFixture();
  const core = executor(t, async function* (...args) {
    calls++;
    yield* fixture.invoke(...args);
  });
  const value = input();
  assert.throws(() => core.invokeFrames(value, { streamLimits: { hostFrameMaxBytes: -1 } }));
  assert.equal(calls, 0);
  assert.equal((await collect(core.invokeFrames(value))).at(-1).control.state, "completed");
  assert.equal(calls, 1);
});

test("unconsumed iterators reserve no capacity and snapshot caller input", async (t) => {
  const core = executor(t);
  for (let i = 0; i < 1100; i++) core.invokeFrames(input());
  const value = input();
  const source = core.invokeFrames(value);
  value.inputs[0].text = "mutated";
  value.contexts.items.length = 0;
  const frames = await collect(source);
  const snapshot = frames.find((frame) => frame.kind === "native").payload;
  assert.equal(snapshot.prompt, "answer");
  assert.match(snapshot.modelInput, /current context/);
  assert.doesNotMatch(snapshot.modelInput, /mutated/);
});

test("competing iterators accept one identity; closing an unused one cannot cancel it", async (t) => {
  const core = executor(t);
  const accepted = core.invokeFrames(input());
  const rejected = core.invokeFrames(input());
  await accepted.next();
  await assert.rejects(rejected.next(), (error) => error.code === "EXECUTION_IDENTITY_CONFLICT");
  await rejected.return();
  assert.equal((await collect(accepted)).at(-1).control.state, "completed");
});

test("active paused receipts are not TTL-evicted and the invocation limit is bounded", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const core = executor(t);
  const sources = [];
  for (let i = 0; i < 1024; i++) {
    const source = core.invokeFrames(input(String(i)));
    await source.next();
    sources.push(source);
  }
  t.mock.timers.tick(120001);
  await assert.rejects(core.invokeFrames(input("overflow")).next(), /RUN_CAPACITY_EXHAUSTED/);
  await sources[0].return();
  t.mock.timers.tick(120001);
  const replacement = core.invokeFrames(input("replacement"));
  await replacement.next();
  sources.push(replacement);
  assert.equal((await core.shutdown()).cleanup, "complete");
  await Promise.all(sources.map((source) => source.return()));
});

test("shutdown immediately gates admission, shares attempts and cancels receipt-only calls", async (t) => {
  let calls = 0;
  const core = executor(t, async function* () {
    calls++;
  });
  const source = core.invokeFrames(input());
  await source.next();
  const unconsumed = core.invokeFrames(input("unconsumed"));
  const first = core.shutdown("first");
  assert.equal(core.shutdown("second"), first);
  assert.throws(() => core.register(createExecutorFixture()), /EXECUTOR_CLOSED/);
  await assert.rejects(unconsumed.next(), /EXECUTOR_CLOSED/);
  assert.equal((await first).cleanup, "complete");
  assert.equal((await collect(source)).at(-1).control.state, "cancelled");
  assert.equal(calls, 0);
  assert.throws(() => core.shutdown("bad", 0), /positive safe integer/);
});

test("shutdown timeout retains ownership; late completion changes only the next snapshot", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cleanup = deferred();
  let returns = 0;
  const core = executor(t, () => ({
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return { value: raw, done: false };
    },
    return() {
      returns++;
      return cleanup.promise;
    }
  }));
  const source = core.invokeFrames(input());
  await source.next();
  await source.next();
  const closing = core.shutdown("stop", 20);
  await Promise.resolve();
  t.mock.timers.tick(20);
  const result = await closing;
  assert.deepEqual(result.unresolvedInvocationIds, ["invoke-one"]);
  assert.equal(result.cleanup, "incomplete");
  assert.equal(returns, 1);
  cleanup.resolve({ done: true });
  assert.equal((await core.shutdown("retry", 20)).cleanup, "complete");
  assert.equal(result.cleanup, "incomplete");
  assert.deepEqual(result.unresolvedInvocationIds, ["invoke-one"]);
  await source.return();
});

test("failed cleanup is retryable and does not skip sibling cleanup or reopen admission", async (t) => {
  const attempts = new Map();
  const core = executor(t, (request) => ({
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return { value: raw, done: false };
    },
    async return() {
      const count = (attempts.get(request.invocationId) ?? 0) + 1;
      attempts.set(request.invocationId, count);
      if (request.invocationId === "invoke-bad" && count === 1) throw new Error("cleanup failed");
      return { done: true };
    }
  }));
  const sources = ["bad", "sibling"].map((id) => core.invokeFrames(input(id)));
  for (const source of sources) {
    await source.next();
    await source.next();
  }
  const result = await core.shutdown();
  assert.equal(result.cleanup, "incomplete");
  assert.deepEqual(result.failedCleanupInvocationIds, ["invoke-bad"]);
  assert.equal(attempts.get("invoke-sibling"), 1);
  assert.equal((await core.shutdown()).cleanup, "complete");
  assert.equal(attempts.get("invoke-bad"), 2);
  await assert.rejects(core.invokeFrames(input("new")).next(), /EXECUTOR_CLOSED/);
  await Promise.all(sources.map((source) => source.return()));
});

for (const mode of ["native", "canonical"]) {
  test(`${mode}: direct and isolated worker route original interactions and cancel receipt-only runs`, async (t) => {
    const core = executor(t);
    const worker = await spawnAdapterHost({
      entrypoint: fileURLToPath(new URL("./fixtures/executor-worker.mjs", import.meta.url))
    });
    t.after(() => worker.close());
    for (const target of [core, worker.client]) {
      const value = input("approval", mode, "approval");
      const frames = [];
      for await (const frame of target.invokeFrames(value)) {
        frames.push(frame);
        const waiting =
          mode === "native"
            ? frame.control?.type === "interaction" && frame.control.status === "pending"
            : frame.event?.type === "interaction.requested";
        if (!waiting) continue;
        if (mode === "native") {
          await assert.rejects(
            target.respondNative("wrong-invocation", { requestId: "fixture-approval", payload: {} })
          );
          await target.respondNative(value.invocationId, {
            requestId: "fixture-approval",
            payload: { result: "accepted" }
          });
          await assert.rejects(
            target.respondNative(value.invocationId, { requestId: "fixture-approval", payload: {} })
          );
        } else {
          await assert.rejects(
            target.respondInteraction("wrong-invocation", {
              interactionId: "fixture-approval",
              outcome: "accepted"
            })
          );
          await target.respondInteraction(value.invocationId, {
            interactionId: "fixture-approval",
            outcome: "accepted"
          });
          await assert.rejects(
            target.respondInteraction(value.invocationId, {
              interactionId: "fixture-approval",
              outcome: "accepted"
            })
          );
        }
      }
      assert.equal(frames.at(-1).control.state, "completed");
      assert.equal(frames.filter(isHostTerminal).length, 1);
      const source = target.invokeFrames(input("cancel", mode, "hold"));
      await source.next();
      const result = await target.cancel("invoke-cancel");
      assert.equal(typeof result === "boolean" ? result : result.cancelled, true);
      const cancelled = await collect(source);
      assert.equal(cancelled.at(-1).control.state, "cancelled");
      assert.equal(cancelled.filter(isHostTerminal).length, 1);
    }
  });

  test(`${mode}: real NDJSON worker uses identical Core and preserves frame identity and input`, async (t) => {
    const core = executor(t);
    const worker = await spawnAdapterHost({
      entrypoint: fileURLToPath(new URL("./fixtures/executor-worker.mjs", import.meta.url))
    });
    t.after(() => worker.close());
    assert.notEqual(worker.child.pid, process.pid);
    for (const scenario of [
      "answer",
      "throw",
      "no-terminal",
      ...(mode === "native" ? ["invalid"] : [])
    ]) {
      const value = input(scenario, mode, scenario);
      const local = await collect(core.invokeFrames(value));
      const remote = await collect(worker.client.invokeFrames(value));
      for (const frames of [local, remote]) {
        assert.equal(frames.filter(isHostTerminal).length, 1);
        assert.deepEqual(
          frames.map((frame) => frame.seq),
          frames.map((_, i) => i + 1)
        );
        for (const frame of frames) {
          assertHostFrame(frame);
          assert.equal(frame.invocation_id, value.invocationId);
          assert.equal(frame.run_id, value.runId);
          assert.equal(frame.stream_id, frames[0].stream_id);
        }
      }
      assert.notEqual(local[0].stream_id, remote[0].stream_id);
      const normalize = (frames) =>
        frames.map(({ stream_id: _stream, ...frame }) => {
          const normalized = structuredClone(frame);
          const failure = normalized.event?.payload?.failure ?? normalized.control?.failure;
          if (failure) {
            assert.match(failure.diagnosticId, /^diag_[a-f0-9]+$/);
            assert.ok(Number.isFinite(Date.parse(failure.occurredAt)));
            failure.diagnosticId = "<diagnostic-id>";
            failure.occurredAt = "<failure-time>";
          }
          return normalized;
        });
      assert.deepEqual(normalize(remote), normalize(local));
    }
  });
}

test("a failed terminal ends cancellation while unresolved cleanup remains owned", async (t) => {
  let next = 0,
    cleanups = 0;
  const core = executor(t, () => ({
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return next++ === 0
        ? {
            done: false,
            value: { kind: "control", control: { type: "state", state: "completed" } }
          }
        : { done: true };
    },
    async return() {
      if (++cleanups === 1) throw new Error("first cleanup failed");
      return { done: true };
    }
  }));
  const frames = await collect(core.invokeFrames(input()));
  assert.equal(frames.at(-1).control.state, "failed");
  assert.equal(frames.filter(isHostTerminal).length, 1);
  assert.equal(core.cancel("invoke-one"), false);
  assert.equal((await core.shutdown()).cleanup, "complete");
  assert.equal(cleanups, 2);
});

test("worker shutdown reports incomplete cleanup with a failing exit status", async (t) => {
  const worker = await spawnAdapterHost({
    entrypoint: fileURLToPath(new URL("./fixtures/executor-incomplete-worker.mjs", import.meta.url))
  });
  t.after(() => worker.close());
  const ready = deferred();
  const consume = (async () => {
    for await (const frame of worker.client.invokeFrames(input()))
      if (frame.kind === "native") ready.resolve();
  })();
  const rejected = assert.rejects(consume, /closed|exit|ended/i);
  await ready.promise;
  const exited = once(worker.child, "exit");
  worker.child.stdin.end();
  assert.equal((await exited)[0], 1);
  await rejected;
});

test("a shared worker crash fails its active streams without replaying them in the parent", async (t) => {
  const worker = await spawnAdapterHost({
    entrypoint: fileURLToPath(new URL("./fixtures/executor-worker.mjs", import.meta.url))
  });
  t.after(() => worker.close());
  const ready = deferred();
  const sibling = (async () => {
    for await (const frame of worker.client.invokeFrames(input("sibling", "native", "hold")))
      if (frame.kind === "native") ready.resolve();
  })();
  const rejected = assert.rejects(sibling, /closed|exit|ended/i);
  await ready.promise;
  const exited = once(worker.child, "exit");
  await assert.rejects(
    collect(worker.client.invokeFrames(input("crash", "native", "terminate-worker"))),
    /closed|exit|ended/i
  );
  assert.equal((await exited)[0], 23);
  await rejected;
  assert.notEqual(worker.child.pid, process.pid);
});
