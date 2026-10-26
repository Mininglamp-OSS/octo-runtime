import test from "node:test";
import assert from "node:assert/strict";
import { ImTask } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { validateImConfig } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { failurePayload } from "@mininglamp-oss/octo-runtime-protocol";
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const timeout = (params = {}) => {
  const payload = failurePayload(
    {
      code: "ADAPTER_TIMEOUT",
      timeoutStage: "model",
      timeoutMs: 300000,
      timeoutReason: "model_silence",
      watchdog: { openToolCount: 0 }
    },
    {
      stage: "adapter.invoke",
      defaultDomain: "adapter",
      source: { component: "octo-runtime", adapter: "codex" }
    }
  );
  payload.failure.code = "OH-ADP-3008";
  payload.failure.params = {
    ...payload.failure.params,
    executionCleanup: "complete",
    executionStopped: "confirmed",
    executionStoppedState: "cancelled",
    ...params
  };
  return event("run.failed", payload);
};
function fixture(invoke, policy = {}, options = {}) {
  const config = {
    bot_id: "recovery",
    api_url: "https://im-test.deepminer.com.cn/api",
    adapter: { adapter_type: "codex", workdir: process.cwd() },
    codex_retry: {
      resume_on_model_silence: true,
      initial_delay_ms: 100,
      max_delay_ms: 100,
      ...policy
    }
  };
  const request = createImInvocation(
    config,
    { messageId: "m", senderId: "u", conversationId: "c", text: "original user task" },
    { schema: "octo.context-envelope/v3", items: [] },
    "key",
    { id: "session", generation: 1 },
    new AbortController().signal
  ).request;
  let now = 0;
  const calls = [],
    states = [];
  const time = {
    now: () => now,
    schedule: () => () => {},
    random: () => 0,
    async wait(ms, signal) {
      signal.throwIfAborted();
      await options.wait?.();
      signal.throwIfAborted();
      now += ms;
    }
  };
  const task = new ImTask(
    {
      async *invoke(input) {
        calls.push(structuredClone(input));
        yield* invoke(input, calls.length);
      },
      async cancelInvocation() {
        return { accepted: true };
      }
    },
    request,
    options.adapter ?? "codex",
    config,
    {},
    () => {},
    time,
    (state) => {
      states.push(state);
      options.state?.(state);
    }
  );
  return {
    task,
    calls,
    states,
    collect: async () => {
      const out = [];
      for await (const e of task.events()) out.push(e);
      return out;
    }
  };
}
const session = () =>
  event("session.update", {
    providerSession: { sessionId: "original-provider-thread", resumable: true }
  });

test("confirmed model silence resumes original thread only after exhaustion; one logical terminal", async () => {
  let ended = false;
  const f = fixture(async function* (input, number) {
    if (number === 1) {
      yield session();
      yield timeout();
      assert.equal(f.calls.length, 1);
      ended = true;
    } else {
      assert(ended);
      assert.equal(input.providerSession.sessionId, "original-provider-thread");
      assert.equal(input.providerSession.codexRequireResume, true);
      yield event("run.completed");
    }
  });
  const out = await f.collect();
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].invocationId, f.calls[1].invocationId);
  assert.equal(f.calls[1].runMetadata.taskRunId, f.calls[0].runId);
  assert.notDeepEqual(f.calls[1].inputs, f.calls[0].inputs);
  assert.match(f.calls[1].inputs[0].text, /不要重复/);
  assert.deepEqual(
    out
      .filter((e) => ["run.failed", "run.completed", "run.cancelled"].includes(e.type))
      .map((e) => e.type),
    ["run.completed"]
  );
  assert.deepEqual(
    f.states.map((s) => s.status),
    ["running", "recovering", "running", "completed"]
  );
  assert(f.states.every((s) => s.taskRunId === f.calls[0].runId));
  assert.deepEqual(
    f.states.map((s) => s.revision),
    [1, 2, 3, 4]
  );
});

for (const [label, params] of [
  ["missing cleanup", { executionCleanup: undefined }],
  ["incomplete cleanup", { executionCleanup: "incomplete" }],
  ["proxy closed but execution unknown", { executionStopped: "unknown" }],
  ["missing provider stop evidence", { executionStopped: undefined }],
  ["original turn already completed", { executionStoppedState: "completed" }],
  ["open tool", { openToolCount: 1 }],
  ["other timeout", { timeoutReason: "tool_idle" }]
]) {
  test(`${label} does not submit continuation`, async () => {
    const f = fixture(async function* () {
      yield session();
      yield timeout(params);
    });
    assert.equal((await f.collect()).at(-1).type, "run.failed");
    assert.equal(f.calls.length, 1);
  });
}
for (const status of ["completed", "failed", "cancelled", "open"]) {
  test(`tool ${status} continuation eligibility`, async () => {
    const f = fixture(async function* (_input, n) {
      if (n === 2) {
        yield event("run.completed");
        return;
      }
      yield session();
      yield event("tool_call.create", { id: "tool", name: "write", args: {}, status: "running" });
      if (status !== "open") yield event("tool_call.update", { id: "tool", status });
      yield timeout();
    });
    await f.collect();
    assert.equal(f.calls.length, status === "completed" ? 2 : 1);
  });
}
test("no provider thread, interaction, opt-out and other adapters cannot auto resume", async () => {
  for (const mode of ["no-thread", "interaction", "opt-out", "other-adapter"]) {
    const f = fixture(
      async function* () {
        if (mode !== "no-thread") yield session();
        if (mode === "interaction") yield event("interaction.requested");
        yield timeout();
      },
      { resume_on_model_silence: mode !== "opt-out" },
      { adapter: mode === "other-adapter" ? "other" : "codex" }
    );
    await f.collect();
    assert.equal(f.calls.length, 1, mode);
  }
});
test("progress does not reset total silence continuation cap", async () => {
  const f = fixture(
    async function* () {
      yield session();
      yield event("message.delta", { text: "work" });
      yield timeout();
    },
    { max_model_silence_resumes: 2 }
  );
  await f.collect();
  assert.equal(f.calls.length, 3);
  assert.equal(f.states.at(-1).status, "failed");
});
test("error after terminal is unknown and never resubmits", async () => {
  const f = fixture(async function* () {
    yield session();
    yield timeout();
    throw Error("transport lost");
  });
  await assert.rejects(f.collect(), /transport lost/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.states.at(-1).status, "unknown");
});
test("stop and reset during recovery prevent the next invoke", async () => {
  for (const cancel of [true, false]) {
    const f = fixture(
      async function* () {
        yield session();
        yield timeout();
      },
      {},
      {
        wait: async () => {
          if (cancel) await f.task.cancel();
          else f.task.stopRetries();
        }
      }
    );
    const out = await f.collect();
    assert.equal(f.calls.length, 1);
    assert.equal(out.at(-1).type, cancel ? "run.cancelled" : "run.failed");
  }
});
test("state persistence failure never submits a new execution", async () => {
  const f = fixture(
    async function* () {
      yield session();
      yield timeout();
    },
    {},
    {
      state: (s) => {
        if (s.status === "recovering") throw Error("store unavailable");
      }
    }
  );
  await assert.rejects(f.collect(), /store unavailable/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.states.at(-1).status, "unknown");
});
test("resume policy is validated", () => {
  for (const policy of [
    { resume_on_model_silence: "true" },
    { max_model_silence_resumes: 6 },
    { max_model_silence_resumes: -1 }
  ]) {
    assert.throws(
      () =>
        validateImConfig({
          bot_id: "b",
          api_url: "https://im-test.deepminer.com.cn/api",
          adapter: { adapter_type: "codex" },
          codex_retry: policy
        }),
      /IM_RETRY_CONFIG_INVALID/
    );
  }
});

test("explicit non-resumable session and duplicate tool identities cannot continue", async () => {
  for (const mode of ["non-resumable", "duplicate-tool"]) {
    const f = fixture(async function* () {
      yield event("session.update", {
        providerSession: { sessionId: "thread", resumable: mode !== "non-resumable" }
      });
      if (mode === "duplicate-tool") {
        yield event("tool_call.create", { id: "tool", name: "write", args: {}, status: "running" });
        yield event("tool_call.create", { id: "tool", name: "write", args: {}, status: "running" });
        yield event("tool_call.update", { id: "tool", status: "completed" });
      }
      yield timeout();
    });
    await f.collect();
    assert.equal(f.calls.length, 1, mode);
  }
});
