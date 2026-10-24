import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { mimoCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mimo-code";
import {
  stopCliComponent,
  verificationFailure,
  withVerificationCleanup
} from "./mimo-code-verification.mjs";

async function main() {
  // 手动真实验收：复用用户已配置的 MiMo，工具仅操作临时目录，凭据不写入报告。
  const probe = await mimoCodeAdapter.probe();
  assert.equal(probe.available, true, "MiMo executable must be available");
  const root = await mkdtemp(join(tmpdir(), "octo-mimo-live-"));
  const executor = new AgentExecutor();
  executor.register(mimoCodeAdapter);
  const report = { platform: platform(), arch: arch(), version: probe.version, entries: [] };
  console.log(JSON.stringify({ stage: "probe", ...report }));

  async function sdk(input, onEvent, signal) {
    const cancel = () => executor.cancel(input.invocationId, String(signal.reason));
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for await (const event of executor.invoke(input)) onEvent(event);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async function cli(input, onEvent, signal) {
    const child = spawn(
      process.execPath,
      [resolve("apps/cli/dist/index.js"), "playboard", "--home", join(root, "home")],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let pending = "";
    const closed = new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    });
    const stopped = Promise.withResolvers();
    const invalidOutput = Promise.withResolvers();
    let stopping;
    const stop = () =>
      stopCliComponent(child, {
        gracefulSignal: "SIGINT",
        allowedExitCodes: [0, 130]
      });
    const abort = () => {
      stopping ??= stop();
      void stopping.then(() => stopped.resolve(child.exitCode), stopped.reject);
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      try {
        pending += chunk.toString();
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (line.trim()) onEvent(JSON.parse(line));
        }
      } catch {
        invalidOutput.reject(new Error("MIMO_CLI_OUTPUT_INVALID"));
        abort();
      }
    });
    child.stderr.resume();
    child.stdin.end(JSON.stringify(input));
    if (signal.aborted) abort();
    await withVerificationCleanup(async () => {
      const code = await Promise.race([closed, stopped.promise, invalidOutput.promise]);
      if (pending.trim()) onEvent(JSON.parse(pending));
      assert.ok(code === 0 || (signal.aborted && code === 130), `CLI exited ${code}`);
    }, [() => signal.removeEventListener("abort", abort), () => stopping ?? stop()]);
  }

  async function turn(
    mode,
    run,
    workdir,
    label,
    prompt,
    { providerSession, cancelOnTool = false, model } = {}
  ) {
    const invocationId = randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("mimo_live_timeout"), 120_000);
    const events = [];
    let text = "";
    let session;
    try {
      await run(
        {
          invocationId,
          protocol_mode: "canonical",
          workdir,
          ...(providerSession ? { providerSession } : {}),
          ...(model ? { agentConfig: { model } } : {}),
          inputs: [{ type: "text", text: prompt }],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [
              { namespace: "octo.execution", name: "adapter", payload: { type: "mimo-code" } },
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: "full_access" }
              }
            ]
          }
        },
        (event) => {
          events.push(event);
          if (event.type === "session.update") session = event.payload.providerSession;
          if (event.type === "message.delta" && event.payload.channel !== "analysis")
            text += event.payload.text ?? "";
          if (cancelOnTool && event.type === "tool_call.create")
            controller.abort("bounded_live_cancel");
        },
        controller.signal
      );
    } finally {
      clearTimeout(timer);
    }
    const terminals = events.filter((event) =>
      /^run\.(completed|failed|cancelled)$/.test(event.type)
    );
    assert.equal(terminals.length, 1, `${mode}/${label}: terminal count`);
    assert.equal(
      terminals[0].type,
      cancelOnTool ? "run.cancelled" : "run.completed",
      `${mode}/${label}: unexpected terminal type`
    );
    const entry = {
      mode,
      label,
      invocationId,
      timestamp: new Date().toISOString(),
      sessionId: session?.sessionId,
      model: session?.model,
      terminal: terminals[0].type,
      text: text.trim(),
      toolEvents: events.filter((event) => event.type.startsWith("tool_call.")).length
    };
    report.entries.push(entry);
    console.log(JSON.stringify(entry));
    return { session, text: text.trim() };
  }
  let cleanupComplete = false;
  try {
    await withVerificationCleanup(async () => {
      for (const [mode, run] of [
        ["sdk", sdk],
        ["cli", cli]
      ]) {
        const workdir = await mkdtemp(join(root, `${mode}-`));
        const marker = `MIMO_${mode.toUpperCase()}_${randomUUID().slice(0, 8)}`;
        const first = await turn(
          mode,
          run,
          workdir,
          "text",
          `Remember ${marker}. Reply exactly ${marker}. Do not use tools.`
        );
        assert.equal(first.text, marker);
        assert.ok(first.session?.sessionId);
        const second = await turn(
          mode,
          run,
          workdir,
          "followup",
          "Repeat the marker from my previous message, with no other text. Do not use tools.",
          { providerSession: first.session, model: first.session.model }
        );
        assert.equal(second.text, marker);
        assert.equal(second.session.sessionId, first.session.sessionId);
        const tool = await turn(
          mode,
          run,
          workdir,
          "tool",
          `In this test working directory only, use a tool to write the exact text ${marker} to proof.txt. Then reply exactly TOOL_OK. Do not touch other files.`
        );
        assert.ok(tool.text.includes("TOOL_OK"));
        assert.equal((await readFile(join(workdir, "proof.txt"), "utf8")).trim(), marker);
        await turn(
          mode,
          run,
          workdir,
          "cancel",
          "Use the shell tool to run sleep 20 in this test directory, then reply SLEPT. Do not touch any files.",
          { cancelOnTool: true }
        );
        const reused = await turn(
          mode,
          run,
          workdir,
          "reuse",
          `Reply exactly ${marker}. Do not use tools.`
        );
        assert.equal(reused.text, marker);
      }
    }, [
      async () => {
        const result = await executor.shutdown();
        assert.notEqual(result.cleanup, "incomplete");
        cleanupComplete = true;
      }
    ]);
  } catch (error) {
    // CLI 的组件树独立于进程内 Core；Core 关闭成功不能覆盖 CLI 的未确认状态。
    if (error?.cleanupComplete === false) cleanupComplete = false;
    throw error;
  } finally {
    if (cleanupComplete) await rm(root, { recursive: true, force: true });
    else
      console.error(
        JSON.stringify({ event: "mimo.verification.cleanup_incomplete", retainedHome: root })
      );
  }
  console.log(JSON.stringify({ passed: true, ...report }));
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "mimo.verification.failed",
      code: "MIMO_VERIFICATION_FAILED",
      ...verificationFailure(error)
    })
  );
  process.exitCode = 1;
}
