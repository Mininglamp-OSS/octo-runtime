import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";

for (const policy of ["enforce", "observe"]) {
  test(`explicit ${policy} model silence policy keeps one invocation and never submits another input`, async () => {
    const executor = new AgentExecutor();
    let executions = 0;
    executor.register({
      metadata: {
        type: "silent-observation",
        agentSources: ["provisioned"],
        protocolSupport: {
          protocol: "silent-observation.canonical",
          modes: ["canonical"],
          nativeMethods: []
        }
      },
      async *invoke(request, context) {
        executions++;
        context.reportActivity({ kind: "turn_started", method: "turn_start" });
        yield {
          protocolVersion: 2,
          type: "model_step.started",
          payload: { stepId: "original-turn" }
        };
        try {
          await delay(250, undefined, { signal: request.signal });
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        } catch (error) {
          if (!request.signal.aborted) throw error;
        }
      }
    });
    try {
      const events = [];
      for await (const event of executor.invoke({
        protocol_mode: "canonical",
        invocationId: "original-invocation",
        runId: "run_original",
        sessionId: "original-session",
        approvalMode: "full_access",
        inputs: [{ type: "text", text: "original user input" }],
        contexts: {
          schema: "octo.context-envelope/v3",
          items: [
            {
              namespace: "octo.execution",
              name: "adapter",
              payload: { type: "silent-observation" }
            },
            {
              namespace: "octo.execution",
              name: "limits",
              payload: {
                model_idle_policy: policy,
                model_idle_timeout_ms: 100,
                model_idle_warning_ms: 100,
                first_frame_timeout_ms: 500,
                run_timeout_ms: 2000
              }
            }
          ]
        }
      }))
        events.push(event);
      assert.equal(executions, 1);
      const terminal = events.filter((event) =>
        ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
      );
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].type, policy === "observe" ? "run.completed" : "run.failed");
      if (policy === "enforce") assert.equal(terminal[0].payload.failure.code, "OH-ADP-3008");
    } finally {
      await executor.shutdown();
    }
  });
}
