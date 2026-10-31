import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportVerificationStartup } from "./verification-startup.mjs";

const endpoint = "https://im.deepminer.com.cn/";

// endpoint 子命令不加载执行器；真实执行与离线检查复用此 Core 装配，调用方负责 shutdown。
async function createHost() {
  const { AgentExecutor } = await import("../packages/octo-runtime-executor-core/dist/index.js");
  const { default: codex } = await import("../packages/octo-runtime-adapter-codex/dist/index.js");
  const host = new AgentExecutor();
  host.register(codex);
  return host;
}

const checkStartup = process.argv.includes("--check-startup");
assert.ok(
  !(checkStartup && process.argv.includes("--check-endpoint")),
  "QA_STARTUP_ENDPOINT_CONFLICT: choose startup or endpoint verification"
);
if (checkStartup) {
  await reportVerificationStartup(await createHost(), import.meta.url, ["codex"]);
  process.exit(0);
}

// The native tool performs one fixed, read-only request; no credentials are used.
if (process.argv[2] === "--check-endpoint") {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000), redirect: "error" });
  assert.equal(response.status, 200);
  await response.body?.cancel();
  const receipt = { endpoint, status: response.status, marker: `FORWARDING_${randomUUID()}` };
  await writeFile(process.argv[3], JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
  console.log(receipt.marker);
} else {
  const host = await createHost();
  const directory = await mkdtemp(join(tmpdir(), "octo-codex-forwarding-"));
  const receiptPath = join(directory, "receipt.json");
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = [
    process.execPath,
    fileURLToPath(import.meta.url),
    "--check-endpoint",
    receiptPath
  ]
    .map(shellQuote)
    .join(" ");
  let terminal,
    failureCode,
    text = "",
    completedTools = 0;
  try {
    assert.equal(Object.hasOwn(host.list()[0], "executionFeatures"), false);
    for await (const event of host.invoke(
      {
        inputs: [
          {
            type: "text",
            text: `Run this exact read-only test command once: ${command}\nThen reply exactly with the marker it prints. Do not run other commands, modify other files, or send messages.`
          }
        ],
        contexts: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
            {
              namespace: "octo.execution",
              name: "workspace",
              payload: { mode: "fixed", path: directory }
            },
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ]
        },
        protocol_mode: "canonical",
        runId: `forwarding_${randomUUID()}`
      },
      { signal: AbortSignal.timeout(120000) }
    )) {
      if (event.type === "message.delta" && event.payload.channel !== "analysis")
        text += event.payload.text ?? "";
      if (event.type === "tool_call.update" && event.payload.status === "completed")
        completedTools++;
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
        terminal = event.type;
        failureCode = event.payload.code;
      }
    }
    assert.equal(terminal, "run.completed", failureCode);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.endpoint, endpoint);
    assert.equal(receipt.status, 200);
    assert.ok(text.includes(receipt.marker));
    assert.ok(completedTools > 0);
    console.log(
      JSON.stringify({
        provider: "codex",
        endpoint,
        terminal,
        completedTools,
        nativeCommandCalled: true,
        markerReturned: true,
        executionFeatureField: false
      })
    );
  } finally {
    await host.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}
