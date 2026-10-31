import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ImRuntime } from "../../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { sendMessage } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/messages.js";
import {
  fetchBotGroups,
  getGroupMembers,
  getChannelMessages
} from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/conversations.js";
import { prepareInvokeInput } from "../../../packages/octo-runtime-executor-core/dist/index.js";
import { parseOctoJson } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";

// 显式手动 QA：真实 im-test 收发和附件，确定性 Kernel；不修改系统网络，不输出凭据或正文。
const origin = "https://im-test.deepminer.com.cn";
const marker = `qa255-${randomUUID()}`;
const result = {
  mode: "real-im-controlled-ws-outage",
  provider: "deterministic-fixture",
  cycles: []
};
let runtime,
  directory,
  unblock,
  releaseRun,
  blocked = false,
  wire,
  ownerUid,
  stage = "accounts";
const originalStart = GatewayTransport.prototype.start;
const originalConnect = WukongConnection.prototype.connect;
const originalFetch = globalThis.fetch;
const calls = [],
  receipts = [],
  diagnostics = [];
async function wait(predicate, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(50);
  }
  return false;
}
try {
  assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "QA_ACCOUNTS_REQUIRED");
  const accounts = (await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8"))
    .split(/(?=Bot Name:)/)
    .slice(1)
    .map((block) => {
      const value = (key) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
      return {
        name: value("Bot Name"),
        id: value("Bot ID"),
        token: value("Bot Token"),
        api: value("API Server")
      };
    });
  const receiver = accounts.find(
    (a) => a.name === (process.env.OCTO_255_RECEIVER ?? "orbtex-opencode")
  );
  const sender = accounts.find((a) => a.name === (process.env.OCTO_255_SENDER ?? "orbtex-codex"));
  assert.ok(receiver && sender && receiver.id !== sender.id, "QA_BOTS_REQUIRED");
  for (const bot of [receiver, sender]) {
    assert.equal(bot.api, `${origin}/api`, "QA_ENVIRONMENT_REQUIRED");
    assert.ok(bot.token?.startsWith("bf_"), "QA_BOT_TOKEN_REQUIRED");
  }
  stage = "qa-group";
  const groups = await Promise.all(
    [receiver, sender].map((bot) => fetchBotGroups({ apiUrl: bot.api, botToken: bot.token }))
  );
  const group = groups[0].find(
    (entry) =>
      /^(Channel_QA_|GW_REVIEW_)/.test(entry.name ?? "") &&
      groups[1].some((other) => other.group_no === entry.group_no)
  );
  assert.ok(group, "QA_SHARED_GROUP_REQUIRED");
  const members = await getGroupMembers({
    apiUrl: receiver.api,
    botToken: receiver.token,
    groupNo: group.group_no
  });
  assert.ok(
    [receiver, sender].every((bot) => members.some((member) => member.uid === bot.id)),
    "QA_MEMBERS_REQUIRED"
  );
  directory = await mkdtemp(join(tmpdir(), "octo-255-"));
  await writeFile(
    join(directory, "report.txt"),
    "Issue 255 controlled WebSocket outage QA artifact.\n"
  );
  globalThis.fetch = async (url, options) => {
    const own = new Headers(options?.headers).get("Authorization") === `Bearer ${receiver.token}`;
    const writing = own && /\/bot\/(sendMessage|message\/edit)$/.test(String(url));
    const body = writing ? JSON.parse(options.body) : undefined;
    const response = await originalFetch(url, options);
    if (writing && response.ok) {
      const payload =
        body.payload ??
        (body.content_edit ? JSON.parse(body.content_edit) : { type: 17, state: body.state });
      const rawReceipt = await response.clone().text();
      const receipt = rawReceipt ? parseOctoJson(rawReceipt) : {};
      receipts.push({
        at: Date.now(),
        type: payload.type,
        content: payload.content,
        id: String(body.message_id ?? receipt.message_id),
        state: payload.state,
        seq: body.card_seq ?? payload.card_seq ?? 1,
        operation: body.message_id ? "edit" : "create",
        messageSeq: receipt.message_seq,
        offline: !runtime?.status.connected
      });
    }
    return response;
  };
  GatewayTransport.prototype.start = async function (signal) {
    if (blocked)
      await new Promise((resolve, reject) => {
        const abort = () => reject(new Error("QA_STOPPED"));
        signal.addEventListener("abort", abort, { once: true });
        unblock = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        if (signal.aborted) abort();
      });
    return originalStart.call(this, signal);
  };
  WukongConnection.prototype.connect = async function (registration) {
    await originalConnect.call(this, registration);
    wire = this;
    ownerUid = registration.owner_uid;
  };
  const sendTask = (text) =>
    sendMessage({
      apiUrl: sender.api,
      botToken: sender.token,
      channelId: group.group_no,
      channelType: 2,
      content: text,
      mentionUids: [receiver.id],
      signal: AbortSignal.timeout(10000)
    });
  runtime = new ImRuntime(
    {
      bot_id: receiver.id,
      bf_token: receiver.token,
      api_url: receiver.api,
      typing: false,
      cards: true,
      groups_enabled: true,
      group_ids: [group.group_no],
      allowed_sender_ids: [sender.id],
      adapter: { adapter_type: "codex", workdir: directory },
      artifact_delivery: { allowed_roots: [directory] },
      run_timeout_ms: 60000
    },
    {
      onDiagnostic: (code) => diagnostics.push(code),
      kernel: {
        async *invoke(input) {
          const prompt = prepareInvokeInput(input).request.prompt;
          calls.push(prompt);
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: {
              messageId: randomUUID(),
              channel: "commentary",
              text: "Controlled WS outage QA"
            }
          };
          if (prompt.endsWith(":0"))
            await new Promise((resolve) => {
              releaseRun = resolve;
            });
          const artifact = prompt.endsWith(":0:2") ? "\n[report](report.txt)" : "";
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: {
              messageId: randomUUID(),
              channel: "final",
              text: `${prompt}:result${artifact}`
            }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          releaseRun?.();
          return { accepted: true };
        },
        async respondInteraction() {}
      }
    }
  );
  stage = "connect";
  await runtime.start();
  assert.ok(await wait(() => runtime.status.connected), "QA_CONNECT_TIMEOUT");
  assert.ok(
    members
      .filter((member) => member.robot !== 1 && member.robot !== true)
      .every((member) => member.uid === ownerUid),
    "QA_GROUP_HAS_OTHER_HUMANS"
  );
  const expected = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    stage = `cycle-${cycle}-admission`;
    const tasks = [0, 1, 2].map((index) => `${marker}:${cycle}:${index}`);
    expected.push(...tasks);
    const cardsBefore = receipts.filter((r) => r.type === 17).length;
    await sendTask(tasks[0]);
    assert.ok(await wait(() => calls.includes(tasks[0]) && releaseRun), "QA_INVOKE_TIMEOUT");
    assert.ok(
      await wait(() => receipts.filter((r) => r.type === 17).length > cardsBefore),
      "QA_PROGRESS_CARD_REQUIRED"
    );
    const originalCard = receipts.filter((r) => r.type === 17).at(-1);
    for (const task of tasks.slice(1)) await sendTask(task);
    assert.ok(await wait(() => runtime.status.queuedTasks === 2), "QA_QUEUE_TIMEOUT");
    stage = `cycle-${cycle}-outage`;
    blocked = true;
    const disconnectedAt = Date.now();
    wire.onDisconnect(new Error("IM_DISCONNECTED"));
    assert.ok(await wait(() => !runtime.status.connected && unblock), "QA_OUTAGE_TIMEOUT");
    const finalsBefore = receipts.filter((r) => r.type === 1).length;
    releaseRun();
    releaseRun = undefined;
    assert.ok(
      await wait(() => runtime.status.workingTasks === 0 && runtime.status.queuedTasks === 0),
      "QA_DRAIN_TIMEOUT"
    );
    assert.equal(runtime.status.connected, false, "QA_WS_RECOVERED_TOO_EARLY");
    for (const task of tasks)
      assert.equal(calls.filter((call) => call === task).length, 1, "QA_DUPLICATE_INVOKE");
    const finals = receipts.filter((r) => r.type === 1).slice(finalsBefore);
    assert.equal(finals.length, 3, "QA_FINAL_RECEIPTS_REQUIRED");
    assert.ok(
      finals.every((r) => r.offline),
      "QA_FINAL_WAITED_FOR_WS"
    );
    assert.ok(
      tasks.every((task) => finals.some((r) => r.content.includes(`${task}:result`))),
      "QA_FINAL_CONTENT_MISSING"
    );
    assert.ok(
      receipts.some(
        (r) =>
          r.id === originalCard.id && r.operation === "edit" && r.state === "completed" && r.offline
      ),
      "QA_ORIGINAL_CARD_NOT_COMPLETED"
    );
    const history = await getChannelMessages({
      apiUrl: receiver.api,
      botToken: receiver.token,
      channelId: group.group_no,
      channelType: 2,
      limit: 100
    });
    for (const task of tasks)
      assert.ok(
        history.some((m) => m.content.includes(`${task}:result`)),
        "QA_HISTORY_MISSING"
      );
    const restoredAt = Date.now();
    blocked = false;
    unblock();
    unblock = undefined;
    assert.ok(await wait(() => runtime.status.connected), "QA_RECONNECT_TIMEOUT");
    result.cycles.push({
      admitted: 3,
      queued: 2,
      finalsWhileOffline: finals.length,
      finalReceiptMsAfterDisconnect: finals.map((r) => r.at - disconnectedAt),
      historyReadbackWhileOffline: true,
      originalProgressCardCompletedWhileOffline: true,
      wsRecoveryMsAfterRelease: Date.now() - restoredAt
    });
  }
  await wait(() => runtime.status.workingTasks === 0);
  const cards = receipts.filter((r) => r.type === 17);
  result.cards = {
    creates: new Set(cards.filter((r) => r.operation === "create").map((r) => r.id)).size,
    terminalCardsWhileOffline: cards.filter((r) => r.offline && r.state === "completed").length
  };
  result.fileCardsWhileOffline = receipts.filter((r) => r.type === 8 && r.offline).length;
  assert.equal(result.cards.creates, 9, "QA_CARD_CREATES_REQUIRED");
  assert.equal(result.cards.terminalCardsWhileOffline, 9, "QA_CARD_TERMINALS_REQUIRED");
  assert.ok(
    cards.every(
      (entry, index) =>
        !cards
          .slice(0, index)
          .some((previous) => previous.id === entry.id && previous.seq >= entry.seq)
    ),
    "QA_CARD_SEQUENCE_REGRESSED"
  );
  assert.equal(result.fileCardsWhileOffline, 1, "QA_FILE_CARD_REQUIRED");
  result.acceptedTasksInvokedOnce = expected.every(
    (task) => calls.filter((call) => call === task).length === 1
  );
  result.restMessageSequenceAvailable = receipts
    .filter((r) => r.type === 1)
    .every((r) => Number.isSafeInteger(r.messageSeq) && r.messageSeq > 0);
  result.diagnostics = [...new Set(diagnostics)];
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.stage = stage;
  result.code = /^QA_[A-Z_]+$/.test(error.message)
    ? error.message
    : "QA_REQUEST_OR_ASSERTION_FAILED";
  if (typeof error.status === "number") result.httpStatus = error.status;
  if (typeof error.body === "string") {
    try {
      const code = JSON.parse(error.body)?.error?.code;
      if (typeof code === "string" && /^[a-zA-Z0-9_.-]+$/.test(code)) result.serverCode = code;
    } catch {}
  }
  if (typeof error.code === "string" && /^[a-zA-Z0-9_.-]+$/.test(error.code))
    result.apiCode = error.code;
} finally {
  blocked = false;
  unblock?.();
  releaseRun?.();
  try {
    await runtime?.close();
  } catch {
    result.closeFailed = true;
    result.ok = false;
  }
  GatewayTransport.prototype.start = originalStart;
  WukongConnection.prototype.connect = originalConnect;
  globalThis.fetch = originalFetch;
  if (directory) await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
