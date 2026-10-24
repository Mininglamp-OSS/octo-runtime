import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mimoCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mimo-code";
import {
  readQaAccounts,
  readVerificationTrace,
  stopCliComponent as stop,
  verificationFailure,
  withVerificationCleanup
} from "./mimo-code-verification.mjs";
import {
  createExtraService,
  componentEndpoint
} from "../packages/octo-runtime-host-sdk/dist/index.js";
import { createKernelService } from "../packages/octo-runtime-executor-kernel/dist/index.js";
import * as gateway from "../packages/octo-runtime-extra-channel-gateway/dist/extra.js";
import { verifyBotIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/auth.js";
import {
  fetchBotGroups,
  getChannelMessages
} from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import { sendMessage } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/messages.js";

async function main() {
  // 手动真实 IM/模型验收，凭据只来自显式文件，所有工具限定在临时目录。
  assert.ok(
    process.env.OCTO_CHANNEL_QA_ACCOUNTS,
    "Set OCTO_CHANNEL_QA_ACCOUNTS to the protected QA file"
  );
  const probe = await mimoCodeAdapter.probe();
  assert.equal(probe.available, true, "MiMo executable must be available");
  assert.ok(probe.version, "MiMo executable must report its version");
  const accounts = await readQaAccounts(process.env.OCTO_CHANNEL_QA_ACCOUNTS);
  const [receiver, sender] = accounts;
  assert.ok(receiver && sender, "Two QA Bots are required");
  for (const account of [receiver, sender]) {
    assert.equal(account.api, "https://im-test.deepminer.com.cn/api");
    assert.equal(
      (await verifyBotIdentity(account.api, account.token, AbortSignal.timeout(15000))).bot_uid,
      account.id
    );
  }
  const receiverGroups = await fetchBotGroups({ apiUrl: receiver.api, botToken: receiver.token });
  const senderGroups = await fetchBotGroups({ apiUrl: sender.api, botToken: sender.token });
  const group = receiverGroups.find(
    (value) =>
      value.name.startsWith("Channel_QA_") &&
      senderGroups.some((other) => other.group_no === value.group_no)
  );
  assert.ok(group, "An existing shared Channel_QA_ group is required");
  const absolute = (path) => fileURLToPath(new URL(path, import.meta.url));
  const cliPath = absolute("../apps/cli/dist/index.js");
  const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "omg-"));
  let preserveRoot = false;
  const browserDm = process.env.MIMO_GATEWAY_BROWSER_DM === "1";
  const groupOnly = !browserDm;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const execute = promisify(execFile);
  const report = {
    environment: "im-test",
    version: probe.version,
    groupId: group.group_no,
    receiverId: receiver.id,
    ...(browserDm ? { sender: "human-browser" } : { senderId: sender.id }),
    entries: []
  };
  async function wait(predicate, label, timeout = 120000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await predicate();
      if (value) return value;
      await delay(300);
    }
    throw new Error(`QA timeout: ${label}`);
  }
  async function localCli(home, manifest, args, input) {
    const child = spawn(
      process.execPath,
      [cliPath, "--json", "--home", home, "--manifest", manifest, ...args],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.stdin.end(input ? JSON.stringify(input) : undefined);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    return withVerificationCleanup(async () => {
      const [code] = await once(child, "close", { signal: controller.signal });
      assert.equal(code, 0, `Runtime CLI ${args[0]} failed`);
      return JSON.parse(stdout);
    }, [() => clearTimeout(timer), () => stop(child)]);
  }
  try {
    const modes = process.env.MIMO_GATEWAY_MODE ? [process.env.MIMO_GATEWAY_MODE] : ["sdk", "cli"];
    for (const mode of modes) {
      assert.ok(["sdk", "cli"].includes(mode));
      const home = await mkdtemp(join(root, `${mode}-`));
      const manifest = join(home, "manifest.json");
      await writeFile(
        manifest,
        JSON.stringify({
          version: 1,
          adapters: [
            {
              type: "mimo-code",
              module: absolute("../test/fixtures/mimo-code-live-adapter.js"),
              export: "tracedMimoCodeAdapter"
            }
          ],
          extras: [
            {
              name: "channel-gateway",
              module: absolute("../packages/octo-runtime-extra-channel-gateway/dist/extra.js")
            }
          ]
        })
      );
      const trace = () => readVerificationTrace(join(home, "mimo-trace.jsonl"));
      const config = {
        bot_id: receiver.id,
        bf_token: receiver.token,
        api_url: receiver.api,
        ...(browserDm ? { groups_enabled: false } : { allowed_sender_ids: [sender.id] }),
        group_ids: [group.group_no],
        approval_mode: "full_access",
        cards: false,
        typing: false,
        run_timeout_ms: 120000,
        adapter: { adapter_type: "mimo-code", workdir: home }
      };
      const endpoint = componentEndpoint(home);
      let kernel, extra, kernelChild, gatewayChild;
      const owned = new Set();
      const children = [];
      const startChild = (component) => {
        const child = spawn(
          process.execPath,
          [cliPath, "--home", home, "--manifest", manifest, component, "run"],
          { stdio: "ignore" }
        );
        children.push(child);
        return child;
      };
      const status = async () =>
        mode === "sdk"
          ? (await extra.status()).plugin
          : (await localCli(home, manifest, ["status"]))["channel-gateway"]?.runtime?.status;
      const closeExtra = async () => {
        if (extra) {
          assert.equal((await extra.close()).complete, true);
          extra = undefined;
        }
        await stop(gatewayChild);
        gatewayChild = undefined;
      };
      const load = async (overrides = {}) => {
        await closeExtra();
        const bots = [{ ...config, ...overrides }];
        if (mode === "sdk") {
          extra = createExtraService({
            endpoint,
            module: gateway,
            config: { bots },
            dependencies: {}
          });
          await extra.initialize();
        } else {
          await localCli(home, manifest, ["extraset", "channel-gateway"], { config: { bots } });
          gatewayChild = startChild("channel-gateway");
        }
        await wait(
          async () => (await status().catch(() => undefined))?.bots?.[0]?.state === "online",
          `${mode} online`,
          20000
        );
      };
      const history = (groupChat = groupOnly) =>
        getChannelMessages({
          apiUrl: receiver.api,
          botToken: receiver.token,
          channelId: groupChat ? group.group_no : sender.id,
          channelType: groupChat ? 2 : 1,
          limit: 60
        });
      const send = (content, groupChat = groupOnly, mention = true) =>
        sendMessage({
          apiUrl: sender.api,
          botToken: sender.token,
          channelId: groupChat ? group.group_no : receiver.id,
          channelType: groupChat ? 2 : 1,
          content,
          ...(groupChat && mention ? { mentionUids: [receiver.id] } : {}),
          signal: AbortSignal.timeout(15000)
        });
      const marker = () =>
        `MIMO_GATEWAY_${mode.toUpperCase()}_${randomUUID().slice(0, 8).toUpperCase()}`;
      const replies = [];
      const expectReply = async (text, groupChat = groupOnly) => {
        const message = await wait(
          async () =>
            (await history(groupChat)).find(
              (value) => value.from_uid === receiver.id && value.content?.trim() === text
            ),
          `${mode} reply ${text}`
        );
        replies.push({ messageId: message.message_id, text, group: groupChat });
        return message;
      };
      let monitor;
      await withVerificationCleanup(async () => {
        if (mode === "sdk") {
          kernel = createKernelService({
            endpoint,
            manifest,
            workerEntrypoint: absolute("../packages/octo-runtime-executor-kernel/dist/runner.js")
          });
          await kernel.initialize();
        } else {
          kernelChild = startChild("executor-kernel");
          await wait(
            async () =>
              (await localCli(home, manifest, ["status"]).catch(() => undefined))?.[
                "executor-kernel"
              ]?.runtime?.execution_ready,
            "CLI kernel online",
            20000
          );
        }
        const capture = async () => {
          const { stdout } = await execute("ps", ["-axo", "pid=,ppid="], { timeout: 5000 });
          const rows = stdout
            .trim()
            .split("\n")
            .map((line) => line.trim().split(/\s+/).map(Number));
          const parents = new Set(
            mode === "sdk" ? [(await kernel.client.status()).worker.pid] : [kernelChild.pid]
          );
          let changed = true;
          while (changed) {
            changed = false;
            for (const [pid, ppid] of rows)
              if (parents.has(ppid) && !parents.has(pid)) {
                parents.add(pid);
                owned.add(pid);
                changed = true;
              }
          }
        };
        monitor = setInterval(() => {
          void capture().catch(() => undefined);
        }, 250);
        await load();
        const first = marker();
        if (browserDm) {
          console.log(
            JSON.stringify({
              mode,
              ready: true,
              receiverId: receiver.id,
              browserPrompt: `Reply exactly ${first}, no extra text, no tools.`
            })
          );
          const terminal = await wait(
            async () =>
              (await trace()).find((event) =>
                ["run.completed", "run.failed", "run.cancelled", "invoke.error"].includes(
                  event.type
                )
              ),
            "human browser DM terminal",
            180000
          );
          // Delivery and exact visible text must also be checked in the sending browser.
          await delay(2000);
          const entry = { mode, timestamp: new Date().toISOString(), expected: first, terminal };
          report.entries.push(entry);
          console.log(JSON.stringify(entry));
          return;
        }
        await send(
          `Remember the marker ${first}. Reply exactly ${first}, no extra text, no tools.`
        );
        await expectReply(first);
        const sessions = (await trace()).filter((event) => event.type === "session.update");
        await send("Repeat only the marker from my previous message. No tools.");
        // 相同文本必须来自新的消息，不能让第一轮历史误判续聊通过。
        const firstReplyId = replies[0].messageId;
        await wait(
          async () =>
            (await history()).find(
              (value) =>
                value.from_uid === receiver.id &&
                value.content?.trim() === first &&
                value.message_id !== firstReplyId
            ),
          "follow-up visible reply"
        );
        const nextSessions = (await trace()).filter((event) => event.type === "session.update");
        assert.equal(nextSessions.at(-1).sessionId, sessions.at(-1).sessionId);
        const groupMarker = marker();
        await send(`Reply exactly ${groupMarker}, no extra text, no tools.`, true);
        await expectReply(groupMarker, true);
        if (!groupOnly)
          assert.notEqual(
            (await trace()).filter((event) => event.type === "session.update").at(-1).sessionId,
            sessions.at(-1).sessionId
          );
        const toolMarker = marker();
        await send(
          `Only in your current test working directory, use a tool to write exactly ${toolMarker} to proof.txt. Then reply exactly ${toolMarker}. Do not touch other files.`
        );
        await expectReply(toolMarker);
        assert.equal((await readFile(join(home, "proof.txt"), "utf8")).trim(), toolMarker);
        const toolsBefore = (await trace()).filter(
          (event) => event.type === "tool_call.create"
        ).length;
        await send(
          "Use a shell tool to execute sleep 20 in your current test directory, then reply SLEPT. Do not modify files."
        );
        await wait(
          async () =>
            (await trace()).filter((event) => event.type === "tool_call.create").length >
            toolsBefore,
          "active tool before stop"
        );
        await send("/stop");
        await wait(
          async () => (await trace()).some((event) => event.type === "run.cancelled"),
          "provider cancelled"
        );
        await wait(
          async () =>
            (await history()).some(
              (message) =>
                message.from_uid === receiver.id && message.content?.includes("已请求停止")
            ),
          "visible stop receipt"
        );
        const recovered = marker();
        await send(`Reply exactly ${recovered}, no extra text, no tools.`);
        await expectReply(recovered);
        await load({ allowed_sender_ids: [] });
        const beforeDenied = (await trace()).filter((event) => event.type === "invoke").length;
        await send(`Reply exactly ${marker()}.`);
        await delay(1500);
        assert.equal(
          (await trace()).filter((event) => event.type === "invoke").length,
          beforeDenied
        );
        await load({ group_ids: ["outside-mimo-qa-group"] });
        await send(`Reply exactly ${marker()}.`, true);
        await delay(1500);
        assert.equal(
          (await trace()).filter((event) => event.type === "invoke").length,
          beforeDenied
        );
        await load({ adapter: { ...config.adapter, model: "mimo-qa-model-does-not-exist" } });
        const oldIds = new Set((await history()).map((value) => value.message_id));
        await send(`Reply exactly ${marker()}, no tools.`);
        const failure = await wait(
          async () =>
            (await history()).find(
              (value) =>
                value.from_uid === receiver.id &&
                !oldIds.has(value.message_id) &&
                /失败|error|failed|model/i.test(value.content ?? "")
            ),
          "truthful visible provider failure"
        );
        assert.ok((await trace()).some((event) => event.type === "invoke.error"));
        await load();
        const reloaded = marker();
        await send(`Reply exactly ${reloaded}, no extra text, no tools.`);
        await expectReply(reloaded);
        const events = await trace();
        const entry = {
          mode,
          timestamp: new Date().toISOString(),
          dm: !groupOnly,
          groupMention: true,
          sameSessionFollowup: true,
          isolatedGroupSession: !groupOnly,
          tool: true,
          cancelAndReuse: true,
          deniedSenderAndGroup: true,
          failureMessageId: failure.message_id,
          reload: true,
          replies,
          invocationIds: [...new Set(events.map((event) => event.invocationId))]
        };
        report.entries.push(entry);
        console.log(JSON.stringify(entry));
      }, [
        () => clearInterval(monitor),
        closeExtra,
        async () => {
          if (kernel) assert.equal((await kernel.close()).complete, true);
        },
        () =>
          withVerificationCleanup(
            async () => {},
            children.map((child) => () => stop(child))
          ),
        async () => {
          await delay(300);
          for (const pid of owned) {
            let alive = true;
            try {
              process.kill(pid, 0);
            } catch (error) {
              if (error.code === "ESRCH") alive = false;
              else throw error;
            }
            if (alive)
              throw Object.assign(new Error("MIMO_DESCENDANT_CLEANUP_INCOMPLETE"), { pid });
          }
        }
      ]).catch((error) => {
        if (error?.cleanupComplete === false) preserveRoot = true;
        throw error;
      });
    }
    console.log(
      JSON.stringify({
        ...report,
        ...(browserDm ? { requiresVisibleReplyCheck: true } : { passed: true, scope: "group" })
      })
    );
  } finally {
    if (preserveRoot)
      console.error(
        JSON.stringify({ event: "mimo.gateway.cleanup_incomplete", retainedHome: root })
      );
    else await rm(root, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  // 外部服务错误可能带响应正文或配置；只输出受控状态，不回显原始诊断。
  console.error(
    JSON.stringify({
      event: "mimo.gateway.failed",
      code: "MIMO_GATEWAY_VERIFICATION_FAILED",
      ...verificationFailure(error)
    })
  );
  process.exitCode = 1;
}
