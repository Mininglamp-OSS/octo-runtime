import test from "node:test";
import assert from "node:assert/strict";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { MemoryImSessionStore } from "../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { failurePayload } from "@mininglamp-oss/octo-runtime-protocol";
import { waitFor } from "./runtime-fixture.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
function silence() {
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
    executionStoppedState: "cancelled"
  };
  return event("run.failed", payload);
}
async function fixture(t, invoke) {
  let receive;
  const writes = [],
    calls = [],
    replies = [],
    cards = [];
  const backend = new MemoryImSessionStore();
  const save = backend.save.bind(backend);
  t.mock.method(backend, "save", (key, binding) => {
    save(key, binding);
    writes.push({ key, binding: structuredClone(binding) });
  });
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    receive = (message) => this.callbacks.onMessage(message);
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  const runtime = new ImRuntime(
    {
      bot_id: "task-state",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "codex", workdir: process.cwd() },
      codex_retry: { resume_on_model_silence: true, initial_delay_ms: 100, max_delay_ms: 100 }
    },
    {
      sessions: backend,
      kernel: {
        async *invoke(input) {
          calls.push(structuredClone(input));
          yield* invoke(input, calls.length);
        },
        async cancelInvocation() {
          return { accepted: true };
        },
        async respondInteraction() {}
      }
    }
  );
  await runtime.start();
  t.after(async () => {
    await runtime.close();
    backend.close();
  });
  const send = (text = "private original task") =>
    receive({
      messageId: text,
      senderId: "user",
      conversationId: "chat",
      conversationKind: "direct",
      text,
      buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
      reply: async (text, key) => {
        replies.push({ text, key });
      },
      beginPresentation(runId, _diagnostic, controls) {
        const card = { runId, controls, snapshots: [], finishes: 0 };
        cards.push(card);
        return {
          update: (snapshot) => card.snapshots.push(structuredClone(snapshot)),
          finish: async () => {
            card.finishes++;
          }
        };
      }
    });
  const done = async () =>
    waitFor(() => cards[0]?.finishes === 1 && runtime.status.sessions.length === 0);
  return { runtime, backend, writes, calls, replies, cards, send, done };
}
const provider = () =>
  event("session.update", { providerSession: { sessionId: "original-thread", resumable: true } });

test("IM publishes logical binding states while retaining one card and one final delivery", async (t) => {
  const f = await fixture(t, async function* (_input, attempt) {
    if (attempt === 1) {
      yield provider();
      yield silence();
    } else {
      yield event("message.delta", { messageId: "final", channel: "final", text: "done" });
      yield event("run.completed");
    }
  });
  f.send();
  await f.done();
  const states = f.writes.filter((row) => row.binding.task).map((row) => row.binding.task);
  const transitions = states.filter(
    (state, i) => i === 0 || state.revision !== states[i - 1].revision
  );
  assert.deepEqual(
    transitions.map((s) => s.status),
    ["running", "recovering", "running", "completed"]
  );
  assert(transitions.every((s) => s.taskRunId === f.calls[0].runId));
  assert.equal(f.calls[1].providerSession.sessionId, "original-thread");
  assert.equal(f.cards.length, 1);
  assert.equal(f.cards[0].finishes, 1);
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].text, "done");
  assert.equal(f.replies[0].key, `final:${f.calls[0].runId}`);
  const recovering = f.cards[0].snapshots.find(
    (s) => s.attempts.length === 1 && s.notices?.some((n) => n.code === "retry_scheduled")
  );
  if (recovering) assert.equal(recovering.terminal, undefined);
  assert.equal(f.cards[0].snapshots.filter((s) => s.terminal === "failed").length, 0);
  const current = f.backend.read(f.writes[0].key);
  assert.equal(current.providerSession.sessionId, "original-thread");
  assert.equal(current.task.status, "completed");
  assert.doesNotMatch(JSON.stringify(current.task), /private original task/);
});

for (const operation of ["stop", "reset"]) {
  test(`IM ${operation} during recovery never submits another attempt or contaminates the new binding`, async (t) => {
    const f = await fixture(t, async function* () {
      yield provider();
      yield silence();
    });
    f.send();
    await waitFor(() => f.writes.some((row) => row.binding.task?.status === "recovering"));
    if (operation === "stop") assert.equal(await f.cards[0].controls.cancel(), true);
    else f.send("/reset");
    await f.done();
    assert.equal(f.calls.length, 1);
    const current = f.backend.read(f.writes[0].key);
    if (operation === "reset") {
      assert.equal(current.generation, 2);
      assert.equal(current.task, undefined);
    } else assert.equal(current.task.status, "cancelled");
    assert.equal(f.cards[0].finishes, 1);
  });
}

test("IM transport failure after a timeout terminal remains unknown and does not continue", async (t) => {
  const f = await fixture(t, async function* () {
    yield provider();
    yield silence();
    throw Error("lost tail");
  });
  f.send();
  await f.done();
  assert.equal(f.calls.length, 1);
  assert.equal(f.backend.read(f.writes[0].key).task.status, "unknown");
  assert.equal(f.replies.length, 1);
  assert.equal(f.cards[0].finishes, 1);
});
