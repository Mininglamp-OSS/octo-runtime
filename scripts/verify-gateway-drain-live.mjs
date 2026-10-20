import { execFile, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  startOwnedKernel,
  startExtra,
  componentEndpoint
} from "../packages/octo-runtime-host-sdk/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";
import { kernelInput } from "../test/kernel-fixture.js";

// 凭据只进入测试子进程环境和权限为 0600 的临时 Extra 配置，不写入验收输出。
const directory = await mkdtemp(
  join(process.platform === "darwin" ? "/tmp" : tmpdir(), "od-live-")
);
const execute = promisify(execFile);
const absolute = (path) => fileURLToPath(new URL(path, import.meta.url));
const report = { endpoint: "https://im-test.deepminer.com.cn", platform: process.platform };
const cliMode = process.argv.includes("--cli");
const failDelivery = process.argv.includes("--fail-delivery");
let kernel, gateway;
let stage = "accounts";
const ensure = (condition, code) => {
  if (!condition) throw new Error(code);
};
async function waitFor(predicate, code, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(code);
}
async function cli(account, args, body) {
  const env = {
    ...process.env,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    OCTO_BOT_TOKEN: account.token,
    OCTO_API_BASE_URL: report.endpoint
  };
  delete env.OCTO_BOT_ID;
  delete env.OCTO_PROFILE;
  try {
    const { stdout } = await execute(
      "octo-cli",
      [...args, ...(body ? ["--data", JSON.stringify(body)] : [])],
      { env, timeout: 20000, maxBuffer: 4 << 20 }
    );
    const result = JSON.parse(stdout);
    ensure(result.ok && result.identity.bot_kind === "user_bot", "QA_IDENTITY_INVALID");
    return result.data;
  } catch (error) {
    let code = "QA_CLI_FAILED";
    try {
      const candidate = JSON.parse(error.stderr).error.code;
      if (/^[A-Z0-9_]+$/.test(candidate)) code = candidate;
    } catch {}
    throw new Error(`${args.slice(0, 2).join(".")}:${code}`);
  }
}
try {
  ensure(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "QA_ACCOUNTS_REQUIRED");
  const text = await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8");
  const accounts = text
    .split(/(?=Bot Name:)/)
    .slice(1)
    .map((block) => {
      const value = (key) =>
        block
          .split("\n")
          .find((line) => line.startsWith(`${key}:`))
          ?.slice(key.length + 1)
          .trim();
      return { id: value("Bot ID"), token: value("Bot Token"), api: value("API Server") };
    })
    .filter((account) => account.token?.startsWith("bf_"));
  const [receiver, sender] = accounts;
  ensure(receiver && sender, "QA_TWO_USER_BOTS_REQUIRED");
  for (const account of [receiver, sender]) {
    ensure(account.api === `${report.endpoint}/api`, "QA_TEST_ONLY");
    await cli(account, ["config", "show"]);
  }
  stage = "group";
  const data = await cli(receiver, ["group", "list"]);
  const groups = Array.isArray(data) ? data : (data.groups ?? []);
  const candidates = groups.filter((group) =>
    process.env.OCTO_CHANNEL_QA_GROUP
      ? group.group_no === process.env.OCTO_CHANNEL_QA_GROUP
      : /^Channel_QA_/.test(group.name)
  );
  let group;
  for (const candidate of candidates.reverse()) {
    const data = await cli(receiver, ["group", "members", candidate.group_no]);
    const members = Array.isArray(data) ? data : (data.members ?? []);
    if (
      [receiver, sender].every((account) => members.some((member) => member.uid === account.id))
    ) {
      group = candidate;
      break;
    }
  }
  ensure(group, "QA_SHARED_TEST_GROUP_REQUIRED");
  report.groupFingerprint = createHash("sha256").update(group.group_no).digest("hex").slice(0, 12);
  if (process.argv.includes("--inspect")) {
    report.ready = true;
  } else {
    const history = async () => {
      const data = await cli(receiver, ["message", "sync"], {
        channel_id: group.group_no,
        channel_type: 2,
        limit: 100
      });
      return (data.messages ?? []).map((message) => ({
        ...message,
        payload:
          typeof message.payload === "string"
            ? JSON.parse(Buffer.from(message.payload, "base64").toString("utf8"))
            : message.payload
      }));
    };
    const send = (content) =>
      cli(sender, ["message", "send"], {
        channel_id: group.group_no,
        channel_type: 2,
        payload: { type: 1, content, mention: { uids: [receiver.id] } }
      });
    stage = "kernel";
    const manifest = join(directory, "adapters.json");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        adapters: [
          {
            type: "codex",
            module: absolute("../packages/octo-runtime-adapter-codex/dist/index.js"),
            export: "createCodexAdapter",
            factory: true
          },
          {
            type: "test",
            module: absolute("../test/fixtures/test-adapter.js"),
            export: "testAdapter"
          }
        ]
      }),
      { mode: 0o600 }
    );
    const endpoint = componentEndpoint(directory);
    kernel = await startOwnedKernel({
      endpoint,
      manifest,
      workerEntrypoint: absolute("../packages/octo-runtime-executor-kernel/dist/runner.js")
    });
    const sibling = await kernel.client.submit(kernelInput("wait-for-host-exit"));
    const attemptsFile = join(directory, "send-attempts.ndjson");
    const preload = join(directory, "fail-delivery.mjs");
    const extraEntrypoint = join(directory, "extra-entry.mjs");
    if (failDelivery) {
      await writeFile(
        preload,
        `import { appendFile } from 'node:fs/promises';
import { WukongConnection } from ${JSON.stringify(new URL("../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js", import.meta.url).href)};
import { ImSendError } from ${JSON.stringify(new URL("../packages/octo-runtime-extra-channel-gateway/dist/delivery/text-send.js", import.meta.url).href)};
WukongConnection.prototype.sendText = async function () {
  await appendFile(${JSON.stringify(attemptsFile)}, 'attempt;');
  throw new ImSendError('IM_SEND_REJECTED_TEST', 'failed');
};\n`
      );
      await writeFile(
        extraEntrypoint,
        `await import(${JSON.stringify(pathToFileURL(preload).href)});
await import(${JSON.stringify(new URL("../packages/octo-runtime-host-sdk/dist/extra-entry.js", import.meta.url).href)});\n`
      );
    }
    let contexts = 0;
    const open = async () => {
      const options = {
        endpoint,
        ...(failDelivery ? { entrypoint: extraEntrypoint } : {}),
        declaration: {
          name: "channel-gateway",
          module: absolute("../packages/octo-runtime-extra-channel-gateway/dist/index.js"),
          config: {
            bots: [
              {
                bot_id: receiver.id,
                bf_token: receiver.token,
                api_url: receiver.api,
                group_ids: [group.group_no],
                allowed_sender_ids: [sender.id],
                cards: false,
                typing: false,
                approval_mode: "full_access",
                codex_retry: { enabled: false },
                adapter: { adapter_type: "codex", workdir: directory }
              }
            ]
          }
        },
        dependencies: {
          loadContexts: async () => {
            contexts++;
            return [
              {
                namespace: "extra.qa",
                name: "shutdown-verification",
                guidance:
                  "Follow the explicit test prompt. Never read account or credential files.",
                payload: {}
              }
            ];
          }
        }
      };
      if (!cliMode) return startExtra(options);
      ensure(
        (await runCli(["--home", directory, "extraset", "channel-gateway"], {
          input: Readable.from([
            JSON.stringify({
              module: options.declaration.module,
              config: options.declaration.config
            })
          ]),
          output() {}
        })) === 0,
        "QA_CLI_CONFIG_FAILED"
      );
      const entrypoint = absolute("../apps/cli/dist/index.js");
      const child = spawn(
        process.execPath,
        [entrypoint, "--home", directory, "channel-gateway", "run"],
        {
          stdio: ["ignore", "pipe", "ignore"],
          ...(failDelivery
            ? {
                env: {
                  ...process.env,
                  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`
                }
              }
            : {})
        }
      );
      let output = "",
        closing;
      const exited = new Promise((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      });
      void exited.catch(() => undefined);
      child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-8192);
      });
      const stop = () =>
        (closing ??= (async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          let timer;
          try {
            const code = await Promise.race([
              exited,
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  child.kill("SIGKILL");
                  reject(new Error("QA_CLI_STOP_TIMEOUT"));
                }, 8000);
              })
            ]);
            return { complete: code === 0 };
          } finally {
            clearTimeout(timer);
          }
        })());
      try {
        await waitFor(() => {
          ensure(child.exitCode === null, "QA_CLI_EARLY_EXIT");
          return output.includes('"state":"ready"');
        }, "QA_CLI_START_TIMEOUT");
      } catch (error) {
        await stop();
        throw error;
      }
      return {
        async status() {
          const { stdout } = await execute(
            process.execPath,
            [entrypoint, "--home", directory, "status"],
            {
              timeout: 10000,
              maxBuffer: 1 << 20
            }
          );
          return JSON.parse(stdout)["channel-gateway"].runtime.status;
        },
        stop
      };
    };
    stage = "gateway";
    gateway = await open();
    await waitFor(
      async () => (await gateway.status()).bots?.[0]?.state === "online",
      "QA_GATEWAY_OFFLINE"
    );
    const before = new Set((await history()).map((message) => message.message_id));
    const marker = `DRAIN_QA_${randomUUID().replaceAll("-", "")}`;
    stage = "invoke";
    await send(
      `Use the shell tool to run sleep 60. After it finishes, reply exactly ${marker}. Do not modify files or send messages through any tool.`
    );
    const task = await waitFor(async () => {
      const bot = (await gateway.status()).bots?.[0];
      return bot?.workingTasks === 1 && bot.tasks?.[0];
    }, "QA_INVOCATION_NOT_ACCEPTED");
    const attempt = task.attempts.at(-1);
    const session = (await gateway.status()).bots[0].sessions.find(
      (session) => session.runId === task.runId
    );
    ensure(attempt && session, "QA_RUN_IDENTITY_MISSING");
    const key = {
      agent_session_id: session.sessionId,
      session_generation: session.generation,
      run_id: attempt.runId,
      invocation_id: attempt.invocationId,
      protocol_mode: "canonical"
    };
    const { ref } = await waitFor(async () => {
      try {
        return await kernel.client.get(key);
      } catch (error) {
        if (error.code === "RUN_NOT_AVAILABLE") return undefined;
        throw error;
      }
    }, "QA_KERNEL_ACCEPTANCE_MISSING");
    const observed = [];
    const observing = (async () => {
      for await (const frame of kernel.client.subscribe(ref)) {
        observed.push(frame);
      }
    })();
    void observing.catch(() => undefined);
    await waitFor(
      () => observed.some((frame) => frame.event?.type === "tool_call.create"),
      "QA_REAL_TOOL_NOT_STARTED",
      90000
    );
    stage = "stop";
    const started = performance.now();
    const stopped = await gateway.stop();
    report.stopMs = Math.round(performance.now() - started);
    ensure(
      stopped.complete === !failDelivery,
      failDelivery ? "QA_SEND_FAILURE_HIDDEN" : "QA_STOP_INCOMPLETE"
    );
    ensure((await gateway.stop()).complete === stopped.complete, "QA_REPEATED_STOP_CHANGED");
    gateway = undefined;
    await observing;
    ensure((await kernel.client.get(ref)).terminal, "QA_TERMINAL_MISSING");
    ensure(!(await kernel.client.get(sibling.ref)).terminal, "QA_SIBLING_INTERRUPTED");
    ensure((await kernel.client.status()).execution_ready, "QA_KERNEL_INTERRUPTED");
    const finals = (await history()).filter(
      (message) =>
        !before.has(message.message_id) &&
        message.from_uid === receiver.id &&
        message.payload?.type === 1
    );
    ensure(finals.length === (failDelivery ? 0 : 1), "QA_UNIQUE_FINAL_MISSING");
    const result = {
      realCodexTool: true,
      terminal: true,
      ...(failDelivery
        ? {
            injectedSendFailure: true,
            incompleteReported: true,
            sendAttempts: (await readFile(attemptsFile, "utf8")).split(";").filter(Boolean).length
          }
        : { finalPresentAtStop: true }),
      siblingPreserved: true,
      kernelPreserved: true,
      ...(cliMode ? {} : { contextsLoaded: contexts > 0 })
    };
    if (!failDelivery) {
      stage = "restart";
      gateway = await open();
      await waitFor(
        async () => (await gateway.status()).bots?.[0]?.state === "online",
        "QA_RESTART_OFFLINE"
      );
      const completed = `RESTART_QA_${randomUUID().replaceAll("-", "")}`;
      await send(`Reply with exactly ${completed}. Do not use any tools.`);
      await waitFor(
        async () =>
          (await history()).some(
            (message) =>
              message.from_uid === receiver.id && message.payload?.content?.includes(completed)
          ),
        "QA_RESTART_REPLY_MISSING",
        90000
      );
      await waitFor(
        async () => (await gateway.status()).bots?.[0]?.workingTasks === 0,
        "QA_RESTART_TURN_ACTIVE"
      );
      ensure((await gateway.stop()).complete, "QA_RESTART_STOP_INCOMPLETE");
      gateway = undefined;
      result.restartedAndReplied = true;
    }
    report[cliMode ? "cli" : "sdk"] = result;
    await kernel.client.cancel(sibling.ref);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = /^[A-Za-z0-9_.:-]+$/.test(error.message) ? error.message : "QA_VERIFICATION_FAILED";
  console.error(JSON.stringify({ stage, error: code }));
  process.exitCode = 1;
} finally {
  if (gateway) await gateway.stop().catch(() => undefined);
  if (kernel) await kernel.stop().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
