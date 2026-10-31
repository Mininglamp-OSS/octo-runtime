import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ImRuntime } from "../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { MemoryImSessionStore } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";
import { WukongConnection } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { sessionCommand } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/session-command.js";
import { waitFor } from "../runtime-fixture.js";

const commands = ["/reset", "/new", "/stop"];
function mentioned(text, label = "助理 Bot😀", uid = "bot") {
  const prefix = `@${label}`;
  return {
    type: 1,
    content: `${prefix} ${text}`,
    mention: { uids: [uid], entities: [{ uid, offset: 0, length: prefix.length }] }
  };
}
const inbound = (payload, changes = {}) => ({
  messageId: randomUUID(),
  channelId: "group",
  channelType: 2,
  fromUid: "user",
  payload,
  ...changes
});

test("only complete stripped inputs are commands; semantic slash text stays ordinary", () => {
  for (const command of commands) {
    assert.equal(sessionCommand(inbound(mentioned(command)), "bot"), command);
    for (const entities of [undefined, []])
      assert.equal(
        sessionCommand(
          inbound({ type: 1, content: `\n${command}  `, mention: { uids: ["bot"], entities } }),
          "bot"
        ),
        command
      );
  }
  for (const text of [
    "帮我看一下/stop为啥不生效",
    "/stop 为啥不生效",
    "解释 /reset 和 /new",
    "/stop now",
    "/reset /stop",
    "`/stop`",
    "```\n/stop\n```",
    "> /stop",
    "/STOP",
    "/new session"
  ])
    assert.equal(sessionCommand(inbound(mentioned(text)), "bot"), null, text);
});

test("native UTF-16 prefix supports whitespace, names, repeated and unsorted mentions", () => {
  const first = "@其他😀",
    second = "@助理 Bot😀";
  const content = ` \n${first}\t${second}${second}\n/stop \t`;
  const payload = {
    type: 1,
    content,
    mention: {
      uids: ["other", "bot"],
      entities: [
        { uid: "bot", offset: 3 + first.length + second.length, length: second.length },
        { uid: "other", offset: 2, length: first.length },
        { uid: "bot", offset: 3 + first.length, length: second.length }
      ]
    }
  };
  const original = structuredClone(payload);
  assert.equal(sessionCommand(inbound(payload), "bot"), "/stop");
  assert.deepEqual(payload, original);
});

test("invalid or non-prefix entities never turn ordinary text into controls", () => {
  const base = mentioned("/stop"),
    entity = base.mention.entities[0];
  for (const patch of [
    { offset: -1 },
    { offset: 0.5 },
    { offset: NaN },
    { offset: Infinity },
    { length: 0 },
    { length: -1 },
    { length: 1 },
    { length: 1000 },
    { length: entity.length - 1 },
    { uid: "other" },
    { uid: "" },
    { uid: 1 },
    { offset: "0" },
    { length: "5" }
  ])
    assert.equal(
      sessionCommand(
        inbound({ ...base, mention: { ...base.mention, entities: [{ ...entity, ...patch }] } }),
        "bot"
      ),
      null,
      JSON.stringify(patch)
    );
  for (const entities of [null, {}, "bad", [null], [[]], [entity, entity]])
    assert.equal(
      sessionCommand(inbound({ ...base, mention: { ...base.mention, entities } }), "bot"),
      null
    );
  assert.equal(sessionCommand(inbound(mentioned("/stop", "   ")), "bot"), null);
  assert.equal(
    sessionCommand(
      inbound({
        type: 1,
        content: "/stop @Bot",
        mention: { uids: ["bot"], entities: [{ uid: "bot", offset: 6, length: 4 }] }
      }),
      "bot"
    ),
    null
  );
  for (const type of [8, 11, 14, 18])
    assert.equal(sessionCommand(inbound({ ...base, type }), "bot"), null);
  assert.equal(sessionCommand(inbound({ ...base, mention: { uids: ["bot"] } }), "bot"), null);
});

async function fixture(t, channelType, config = {}) {
  const botId = config.bot_id ?? "bot";
  let wire,
    hold = false;
  const calls = [],
    cancellations = [],
    replies = [],
    resets = [],
    preparations = [];
  const pending = new Map(),
    store = new MemoryImSessionStore();
  const originalReset = store.reset.bind(store);
  t.mock.method(store, "reset", (key, id) => {
    resets.push({ key, id });
    return originalReset(key, id);
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: botId, space_id: "space" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: botId,
        owner_uid: "user",
        owner_channel_id: "user",
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: randomUUID()
      });
    if (url.endsWith("/md")) {
      preparations.push("rules");
      return new Response(null, { status: 404 });
    }
    if (url.includes("/sync")) {
      preparations.push("history");
      return Response.json({ messages: [] });
    }
    if (url.endsWith("/readReceipt")) return Response.json({});
    if (url.endsWith("/bot/sendMessage")) {
      replies.push(JSON.parse(options.body));
      return Response.json({ message_id: randomUUID() });
    }
    throw new Error(`unexpected fixture request: ${url}`);
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    wire = this;
  });
  t.mock.getter(WukongConnection.prototype, "connected", () => true);
  t.mock.method(WukongConnection.prototype, "close", async () => {});
  const runtime = new ImRuntime(
    {
      bot_id: "bot",
      api_url: "https://im-test.deepminer.com.cn/api",
      bf_token: `bf_${randomUUID()}`,
      cards: false,
      typing: false,
      adapter: { adapter_type: "codex", workdir: process.cwd() },
      ...config
    },
    {
      sessions: store,
      kernel: {
        async *invoke(input) {
          calls.push(input);
          if (hold) {
            await new Promise((resolve) => pending.set(input.invocationId, resolve));
            yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
          } else {
            yield {
              protocolVersion: 2,
              type: "session.update",
              payload: { providerSession: { sessionId: "provider", resumable: true } }
            };
            yield {
              protocolVersion: 2,
              type: "message.delta",
              payload: { messageId: randomUUID(), channel: "final", text: "fixture answer" }
            };
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          }
        },
        async cancelInvocation(id) {
          cancellations.push(id);
          pending.get(id)?.();
          pending.delete(id);
          return { accepted: true };
        },
        async respondInteraction() {}
      }
    }
  );
  t.after(async () => {
    hold = false;
    await runtime.close();
    store.close();
  });
  await runtime.start();
  assert.equal(runtime.status.connected, true);
  const channelId = channelType === 5 ? "group____topic" : channelType === 1 ? "user" : "group";
  return {
    runtime,
    store,
    calls,
    cancellations,
    replies,
    resets,
    preparations,
    hold: () => {
      hold = true;
    },
    send(payload, changes = {}) {
      const message = inbound(payload, { channelType, channelId, ...changes });
      wire.onMessage(message);
      return message;
    },
    idle: () =>
      waitFor(() => runtime.status.workingTasks === 0 && runtime.status.sessions.length === 0)
  };
}

for (const channelType of [2, 5]) {
  for (const command of commands) {
    test(`channel ${channelType} handles prefixed ${command} without enqueuing or preparing a Run`, async (t) => {
      const f = await fixture(t, channelType);
      const message = f.send(mentioned(command));
      assert.equal(f.runtime.status.queuedTasks, 0);
      assert.equal(f.runtime.status.workingTasks, 0);
      assert.deepEqual(f.runtime.status.tasks, []);
      assert.equal(f.calls.length, 0);
      await waitFor(() => f.replies.length === 1);
      assert.equal(f.replies[0].channel_type, channelType);
      assert.equal(f.replies[0].channel_id, message.channelId);
      assert.equal(
        f.replies[0].payload.content,
        command === "/stop" ? "当前没有可停止的执行。" : "会话已经重置"
      );
      assert.deepEqual(f.preparations, []);
      assert.equal(f.calls.length, 0);
      assert.equal(f.resets.length, command === "/stop" ? 0 : 1);
      if (f.resets.length) assert.equal(f.store.read(f.resets[0].key).generation, 2);
      f.send(message.payload, { messageId: message.messageId });
      await f.idle();
      assert.equal(f.resets.length, command === "/stop" ? 0 : 1);
      assert.equal(f.replies.length, 1);
    });
  }

  test(`channel ${channelType} semantic slash inputs reach exactly one ordinary AgentRun`, async (t) => {
    const f = await fixture(t, channelType);
    for (const text of [
      "帮我看一下/stop为啥不生效",
      "/stop 为啥不生效",
      "解释 /reset 和 /new",
      "ordinary prompt"
    ]) {
      const payload = mentioned(text),
        count = f.calls.length;
      f.send(payload);
      await waitFor(() => f.calls.length === count + 1);
      await f.idle();
      assert.equal(f.calls.at(-1).inputs[0].text, payload.content);
    }
    assert.deepEqual(f.cancellations, []);
    assert.deepEqual(f.resets, []);
  });

  test(`channel ${channelType} blocks broadcast controls including expanded UIDs and mixed mentions`, async (t) => {
    const f = await fixture(t, channelType);
    const ordinary = async (payload) => {
      const count = f.calls.length;
      f.send(payload);
      await waitFor(() => f.calls.length === count + 1);
      await f.idle();
      assert.equal(f.calls.at(-1).inputs[0].text, payload.content);
    };
    for (const command of commands) {
      for (const flag of ["all", "humans", "ais"]) {
        for (const value of [1, true]) {
          const payload = mentioned(command);
          payload.mention[flag] = value;
          await ordinary(payload);
          await ordinary({ type: 1, content: command, mention: { [flag]: value, uids: ["bot"] } });
        }
      }
      await ordinary({
        type: 1,
        content: `@所有AI ${command}`,
        mention: { ais: 1, uids: ["bot"], entities: [{ uid: "-3", offset: 0, length: 5 }] }
      });
    }
    await f.idle();
    assert.deepEqual(f.resets, []);
    assert.deepEqual(f.cancellations, []);
    assert.equal(
      f.replies.some((reply) =>
        /会话已经重置|已请求停止|当前没有可停止/.test(reply.payload.content)
      ),
      false
    );
  });

  for (const command of ["/reset", "/new"]) {
    test(`channel ${channelType} ${command} replaces binding only on the next ordinary input`, async (t) => {
      const f = await fixture(t, channelType);
      f.send(mentioned("first task"));
      await waitFor(() => f.calls.length === 1);
      await f.idle();
      const first = f.calls[0];
      f.send(mentioned(command));
      await waitFor(
        () =>
          f.resets.length === 1 &&
          f.replies.some((reply) => reply.payload.content === "会话已经重置")
      );
      const resetBinding = f.store.read(f.resets[0].key);
      assert.equal(resetBinding.id, undefined);
      assert.equal(resetBinding.providerSession, undefined);
      assert.equal(resetBinding.rulesContext, undefined);
      assert.equal(f.calls.length, 1);
      f.send(mentioned("second task"));
      await waitFor(() => f.calls.length === 2);
      await f.idle();
      assert.notEqual(f.calls[1].sessionId, first.sessionId);
      assert.equal(f.calls[1].sessionGeneration, first.sessionGeneration + 1);
      assert.equal(f.calls[1].providerSession, undefined);
      assert.equal(f.calls[1].workdir, first.workdir);
    });
  }

  test(`channel ${channelType} stop cancels the existing invocation and reset preserves it`, async (t) => {
    const f = await fixture(t, channelType);
    f.hold();
    f.send(mentioned("long task"));
    await waitFor(() => f.calls.length === 1 && f.runtime.status.sessions[0]?.active);
    f.send(mentioned("/new"));
    await waitFor(() => f.replies.some((reply) => reply.payload.content === "会话已经重置"));
    assert.deepEqual(f.cancellations, []);
    const generation = f.runtime.status.sessions[0].generation;
    f.send(mentioned("/stop"));
    await waitFor(() => f.cancellations.length === 1);
    assert.equal(f.cancellations[0], f.calls[0].invocationId);
    await f.idle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.store.read(f.resets[0].key).generation, generation);
    assert.ok(f.replies.some((reply) => reply.payload.content === "已请求停止本轮执行。"));
  });

  test(`channel ${channelType} rejects invalid admission before any control or execution`, async (t) => {
    const f = await fixture(t, channelType, { allowed_sender_ids: ["user"], group_ids: ["group"] });
    for (const changes of [
      { fromUid: "bot" },
      { fromUid: "" },
      { fromUid: "other" },
      { channelId: "other____topic" },
      { messageId: "" }
    ])
      f.send(mentioned("/reset"), changes);
    f.send({ ...mentioned("/stop"), space_id: "other" });
    f.send(mentioned("/new", "Other", "other"));
    f.send({ type: 1, content: "@Bot /reset" });
    await f.idle();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.replies, []);
    assert.deepEqual(f.resets, []);
  });
}

test("DM retains reset/new/stop behavior without native mentions", async (t) => {
  const f = await fixture(t, 1);
  for (const command of commands) f.send({ type: 1, content: command });
  await waitFor(() => f.replies.length === 3);
  assert.equal(f.resets.length, 2);
  assert.deepEqual(f.calls, []);
});

test("reset failure returns failure and never falls through to the model", async (t) => {
  const f = await fixture(t, 2);
  t.mock.method(f.store, "reset", () => {
    throw new Error("store unavailable");
  });
  f.send(mentioned("/reset"));
  await waitFor(() => f.replies.length === 1);
  assert.equal(f.replies[0].payload.content, "会话重置失败，请重试。");
  assert.deepEqual(f.calls, []);
  assert.equal(f.runtime.status.workingTasks, 0);
});

for (const channelType of [2, 5]) {
  test(`channel ${channelType} native prefix controls only the directly mentioned bot`, async (t) => {
    const a = await fixture(t, channelType, { bot_id: "bot-A" });
    const b = await fixture(t, channelType, { bot_id: "bot-B" });
    const payload = mentioned("/reset", "Second Bot", "bot-B");
    a.send(payload);
    b.send(payload);
    await waitFor(() => b.resets.length === 1);
    assert.deepEqual(a.resets, []);
    assert.deepEqual(a.calls, []);
    assert.deepEqual(b.calls, []);
  });
}
