import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ExtraPlugins } from "../../packages/octo-runtime-host-sdk/dist/index.js";
import { build_im_contexts } from "../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { MENTION_GUIDANCE } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/mentions.js";
import { WecomTransport } from "../../packages/octo-runtime-extra-channel-wecom/dist/transport/channel.js";
import { WecomConnection } from "../../packages/octo-runtime-extra-channel-wecom/dist/transport/connection.js";
import { waitFor } from "../runtime-fixture.js";

// 保留命名空间专项仅显式本地运行，不加入默认测试或 CI。
const schema = "octo.context-envelope/v3";
const reservedNames = [
  "mention-instructions",
  "artifact-delivery",
  "history-instructions",
  "message-trigger",
  "history",
  "history-gap",
  "group-rules",
  "topic-rules",
  "custom-host-item"
];
const reserved = reservedNames.map((name) => ({
  namespace: "extra.im",
  name,
  guidance: "HOST-RESERVED-MATERIAL",
  payload: { text: "HOST-RESERVED-MATERIAL" }
}));
const business = { namespace: "extra.business", name: "history", payload: { text: "business" } };
const instructions = {
  namespace: "octo.control",
  name: "instructions",
  payload: { entries: [{ text: "host instruction" }, { text: "host instruction" }] }
};
const config = {
  bot_id: "ownership-fixture",
  api_url: "https://im-test.deepminer.com.cn/api",
  spaceId: "synthetic",
  adapter: { adapter_type: "codex", workdir: process.cwd() },
  context: { schema, items: [business, ...reserved, instructions] }
};

for (const kind of ["gateway", "wecom"])
  test(`${kind}: static and dynamic host extra.im are ignored with a warning and AgentRun continues`, async (t) => {
    const base = `../../packages/octo-runtime-extra-channel-${kind}/dist/`;
    const { default: load, name } = await import(`${base}extra.js`);
    const transport = await import(`${base}transport/channel.js`);
    const Transport = transport.GatewayTransport ?? transport.WecomTransport;
    let callbacks;
    const requests = [],
      logs = [],
      replies = [];
    let calls = 0;
    t.mock.method(Transport.prototype, "start", async function () {
      callbacks = this.callbacks;
    });
    t.mock.method(Transport.prototype, "close", async () => {});
    const extras = new ExtraPlugins(
      [],
      {
        async *invoke(request) {
          requests.push(request);
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: true };
        }
      },
      () =>
        (...args) =>
          logs.push(args)
    );
    t.after(() => extras.close());
    const bot =
      kind === "gateway"
        ? config
        : {
            bot_id: config.bot_id,
            adapter: config.adapter,
            context: config.context
          };
    const before = structuredClone(bot);
    await extras.load(
      { name, default: load },
      { bots: [bot] },
      {
        loadContexts() {
          calls++;
          return calls === 1
            ? []
            : reserved.map((item) => ({
                ...item,
                payload: { text: "DYNAMIC-HOST-RESERVED-MATERIAL" }
              }));
        }
      }
    );
    for (const [index, messageId] of ["static", "dynamic"].entries()) {
      callbacks.onMessage({
        messageId,
        senderId: "actor",
        conversationId: "dm",
        conversationKind: "direct",
        text: "task",
        buildContext: async (_signal, options) => ({ schema, items: options.configuredItems }),
        reply: async (text) => {
          replies.push(text);
        }
      });
      await waitFor(() => replies.length === index + 1);
    }
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.doesNotMatch(JSON.stringify(request), /HOST-RESERVED-MATERIAL|custom-host-item/);
      assert.ok(request.contexts.items.some((item) => item.namespace === "extra.business"));
      const entries = request.contexts.items.find((item) => item.namespace === "octo.control")
        .payload.entries;
      assert.deepEqual(entries, [
        ...instructions.payload.entries,
        ...(kind === "gateway" ? [{ text: MENTION_GUIDANCE }] : [])
      ]);
    }
    assert.deepEqual(bot, before);
    const warnings = logs.filter((entry) => entry[1] === "channel.context.reserved_ignored");
    assert.equal(warnings.length, 2);
    for (const warning of warnings) {
      assert.equal(warning[0], "warn");
      assert.equal(warning[2].ignored_items, reserved.length);
    }
    assert.doesNotMatch(JSON.stringify(warnings), /HOST-RESERVED-MATERIAL/);
  });

for (const dynamic of [false, true])
  test(`Gateway buildContext ignores ${dynamic ? "dynamic" : "static"} reserved items before generating facts and rules`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url) =>
      String(url).endsWith("/md")
        ? Response.json({ content: "CHANNEL-GROUP-RULE", version: 1 })
        : Response.json({ more: 0, messages: [] })
    );
    const before = structuredClone(config);
    const items = await build_im_contexts(
      config,
      {
        channelId: "group____topic",
        channelType: 5,
        messageId: "trigger",
        fromUid: "actor",
        payload: { type: 1, content: "task" }
      },
      randomUUID(),
      new AbortController().signal,
      {
        initialSession: true,
        ...(dynamic ? { configuredItems: config.context.items } : {})
      }
    );
    assert.doesNotMatch(JSON.stringify(items), /HOST-RESERVED-MATERIAL|custom-host-item/);
    assert.equal(items.find((item) => item.name === "message-trigger").payload.sender.uid, "actor");
    for (const name of ["group-rules", "topic-rules"])
      assert.equal(items.find((item) => item.name === name).payload.text, "CHANNEL-GROUP-RULE");
    assert.deepEqual(
      items.filter((item) => item.namespace !== "extra.im"),
      [business, instructions]
    );
    assert.deepEqual(config, before);
  });

test("WeCom transport ignores static and dynamic reserved items without dropping global instructions", async (t) => {
  let receive, message;
  t.mock.method(WecomConnection.prototype, "connect", async function () {
    receive = this.callbacks.onMessage;
  });
  t.mock.method(WecomConnection.prototype, "close", async () => {});
  const transport = new WecomTransport(config, async () => randomUUID(), {
    onMessage(value) {
      message = value;
    },
    onDisconnect() {}
  });
  await transport.start(new AbortController().signal);
  t.after(() => transport.close());
  receive({
    headers: { req_id: "request" },
    body: {
      aibotid: config.bot_id,
      msgid: "message",
      msgtype: "text",
      chattype: "single",
      from: { userid: "actor" },
      text: { content: "task" }
    }
  });
  for (const options of [undefined, { configuredItems: config.context.items }]) {
    const context = await message.buildContext(new AbortController().signal, options);
    assert.deepEqual(context.items, [business, instructions]);
  }
});

test("Gateway owns stable contents on refresh, omission, recovery and frozen retry", () => {
  const message = { messageId: "message", senderId: "actor", conversationId: "dm", text: "task" };
  const context = { schema, items: [...reserved.slice(0, 3), business, instructions] };
  const before = structuredClone(context);
  const session = {
    id: "session",
    generation: 1,
    providerSession: { sessionId: "provider", resumable: true }
  };
  const invoke = (input, msg, refresh) =>
    createImInvocation(
      config,
      msg,
      input,
      "scope",
      session,
      new AbortController().signal,
      "occurrence",
      refresh
    );
  const first = invoke(context, message, true);
  assert.equal(first.stableContextIncluded, true);
  assert.doesNotMatch(JSON.stringify(first.request.contexts), /HOST-RESERVED-MATERIAL/);
  const ordinary = invoke(context, message, false);
  assert.equal(ordinary.stableContextIncluded, false);
  assert.equal(
    ordinary.request.contexts.items.some((item) => item.namespace === "extra.im"),
    false
  );
  assert.deepEqual(
    ordinary.recoveryContexts.map((item) => item.name),
    reservedNames.slice(0, 3)
  );
  assert.doesNotMatch(JSON.stringify(ordinary.recoveryContexts), /HOST-RESERVED-MATERIAL/);
  const retry = invoke(first.request.contexts, { ...message, historyRetry: true }, false);
  assert.deepEqual(retry.request.contexts, first.request.contexts);
  assert.deepEqual(context, before);
});
