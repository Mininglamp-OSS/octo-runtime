import test from "node:test";
import assert from "node:assert/strict";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
for (const cleanup of ["complete", "incomplete"]) {
  test(`watchdog carries actual ${cleanup} cleanup evidence`, async () => {
    const executor = new AgentExecutor();
    let close;
    const wait = new Promise((resolve) => {
      close = resolve;
    });
    executor.register({
      metadata: {
        type: "silent",
        agentSources: ["provisioned"],
        protocolSupport: { protocol: "silent.canonical", modes: ["canonical"], nativeMethods: [] }
      },
      async *invoke(request) {
        const timer = setInterval(() => {}, 1000);
        try {
          yield event("message.delta", { messageId: "m", channel: "final", text: "work" });
          await new Promise((resolve) => {
            if (request.signal.aborted) resolve();
            else request.signal.addEventListener("abort", resolve, { once: true });
          });
        } finally {
          clearInterval(timer);
          if (cleanup === "incomplete") await wait;
        }
      }
    });
    const events = [];
    try {
      for await (const e of executor.invoke({
        protocol_mode: "canonical",
        invocationId: "inv",
        runId: "run_cleanup",
        sessionId: "s",
        approvalMode: "full_access",
        inputs: [{ type: "text", text: "input" }],
        contexts: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: "silent" } },
            {
              namespace: "octo.execution",
              name: "limits",
              payload: {
                model_idle_timeout_ms: 100,
                model_idle_warning_ms: 100,
                first_frame_timeout_ms: 500,
                run_timeout_ms: 2000,
                cancel_grace_ms: 100
              }
            }
          ]
        }
      }))
        events.push(e);
      const failure = events.findLast((e) => e.type === "run.failed").payload.failure;
      assert.equal(failure.params.timeoutReason, "model_silence");
      assert.equal(failure.params.executionCleanup, cleanup);
      assert.equal(
        failure.params.executionStopped,
        "unknown",
        "closing the local iterator does not prove the real Provider stopped"
      );
    } finally {
      close();
      await executor.shutdown();
    }
  });
}
