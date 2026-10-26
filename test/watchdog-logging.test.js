import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { RuntimeLogging } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { AgentExecutor } from "../packages/octo-runtime-executor-core/dist/index.js";
import { watchdogLogData } from "../packages/octo-runtime-executor-core/dist/watchdog-log.js";

async function records(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".log"));
  const text = (
    await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")))
  ).join("");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("watchdog 只投影安全测量，磁盘记录丢弃原始错误、正文和凭据", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "watchdog-safe-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logging = new RuntimeLogging({ directory });
  const privateKey = randomUUID();
  const evidence = watchdogLogData({
    event: "timeout",
    data: {
      phase: "model_active",
      elapsedMs: 301000,
      lastProgressAgeMs: 300000,
      lastTransportAgeMs: 1000,
      retryCount: 3,
      lastMethod: "retry",
      timeoutMs: 300000,
      timeoutReason: "model_silence",
      activitySupport: "native_progress",
      prompt: "SECRET_PROMPT",
      error: "SECRET_ERROR",
      apiKey: privateKey
    }
  });
  logging.kernel("warn", "invoke.watchdog", {
    code: "timeout",
    ...evidence,
    diagnostic_id: `diag_${"b".repeat(32)}`,
    rawError: "SECRET_ERROR"
  });
  await logging.close();
  const [row] = await records(directory);
  assert.equal(row.data.diagnostic_id, `diag_${"b".repeat(32)}`);
  assert.equal(row.data.timeout_reason, "model_silence");
  assert.equal(row.data.timeout_ms, 300000);
  assert.equal(row.data.last_progress_age_ms, 300000);
  assert.equal(row.data.last_transport_age_ms, 1000);
  assert.equal(row.data.last_method, "retry");
  assert.equal(row.data.retry_count, 3);
  assert.doesNotMatch(JSON.stringify(row), /SECRET|prompt|apiKey|rawError/);
  assert(!JSON.stringify(row).includes(privateKey));
});

test(
  "model_silence 终态诊断编号能关联到含预算和进展时间的磁盘日志",
  { timeout: 5000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "watchdog-evidence-log-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const logging = new RuntimeLogging({ directory });
    const host = new AgentExecutor({ log: logging.kernel });
    t.after(async () => {
      await host.shutdown();
      await logging.close();
    });
    host.register({
      metadata: {
        type: "silent",
        agentSources: ["provisioned"],
        protocolSupport: { protocol: "silent.canonical", modes: ["canonical"], nativeMethods: [] }
      },
      async *invoke(request, context) {
        context.reportActivity({ kind: "turn_started", method: "turn_start" });
        yield {
          protocolVersion: 2,
          type: "model_step.started",
          payload: { stepId: "silent-step" }
        };
        // Transport/retry events prove liveness, but cannot reset model progress.
        const timer = setInterval(
          () => context.reportActivity({ kind: "retry_notice", method: "retry" }),
          10
        );
        try {
          if (!request.signal.aborted)
            await new Promise((done) =>
              request.signal.addEventListener("abort", done, { once: true })
            );
        } finally {
          clearInterval(timer);
        }
      }
    });
    const runId = `run_${"b".repeat(32)}`;
    const events = [];
    for await (const event of host.invoke({
      inputs: [{ type: "text", text: "SECRET_INPUT" }],
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [
          { namespace: "octo.execution", name: "adapter", payload: { type: "silent" } },
          {
            namespace: "octo.execution",
            name: "limits",
            payload: {
              model_idle_timeout_ms: 150,
              model_idle_warning_ms: 100,
              first_frame_timeout_ms: 500,
              run_timeout_ms: 2000
            }
          }
        ]
      },
      approvalMode: "full_access",
      sessionId: "watchdog-session",
      invocationId: "watchdog-invoke",
      runId,
      protocol_mode: "canonical"
    }))
      events.push(event);
    const terminal = events.findLast((event) => event.type === "run.failed");
    assert.equal(terminal.payload.failure.code, "OH-ADP-3008");
    assert.equal(terminal.payload.failure.params.timeoutMs, 150);
    assert.ok(terminal.payload.failure.params.lastProgressAgeMs >= 150);
    await host.shutdown();
    await logging.close();
    const rows = await records(directory);
    const failure = rows.find((row) => row.event === "invoke.failed");
    assert.equal(failure.data.diagnostic_id, terminal.payload.failure.diagnosticId);
    assert.equal(failure.data.run_id, runId);
    assert.equal(failure.data.code, "OH-ADP-3008");
    const timeout = rows.find(
      (row) => row.event === "invoke.watchdog" && row.data.code === "timeout"
    );
    assert.equal(timeout.data.run_id, failure.data.run_id);
    assert.equal(timeout.data.timeout_reason, "model_silence");
    assert.equal(timeout.data.timeout_ms, 150);
    assert.ok(timeout.data.last_progress_age_ms >= 150);
    assert.ok(timeout.data.retry_count >= 1);
    assert.ok(timeout.data.last_transport_age_ms < timeout.data.last_progress_age_ms);
    assert.equal(timeout.data.open_tool_count, 0);
    assert.doesNotMatch(JSON.stringify(rows), /SECRET_INPUT/);
  }
);
