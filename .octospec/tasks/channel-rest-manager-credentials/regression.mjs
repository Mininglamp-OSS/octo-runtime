import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayTransport } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { ImDeliveryIdentity } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/identity.js";
import { ImDeliveryDispatcher } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js";
import { OctoConnector } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { artifactPolicy } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifact-policy.js";

import { ImRuntime } from "../../../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { ImSendError } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/send-error.js";
import { waitFor } from "../../../test/runtime-fixture.js";

const failed = { protocolVersion: 2, type: "run.failed", payload: { message: "failure" } };

async function fixture(t) {
  const owner = new AbortController();
  const initialToken = `bf_${randomUUID()}`;
  let heldToken = initialToken,
    credentialReads = 0,
    inbound,
    connection,
    hook;
  const requests = [],
    connections = [],
    restReplies = [],
    transports = [];
  let current;
  const identity = new ImDeliveryIdentity();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    options.signal.throwIfAborted();
    requests.push({ url, options });
    const response = await hook?.(url, options);
    if (response) return response;
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: "bot", space_id: "space" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: "bot",
        ws_url: "wss://example.com/ws",
        im_token: randomUUID()
      });
    if (url.endsWith("/bot/events")) return Response.json({ results: [] });
    if (url.endsWith("/bot/card/profile"))
      return Response.json({
        available: true,
        enabled: true,
        card_version: "1.5",
        profiles: ["octo/v1", "octo/v2"],
        config: {
          card_enabled: true,
          display_enabled: true,
          interaction_enabled: true,
          reasoning_enabled: true,
          reasoning_template_ref: { id: "ai.reasoning-process", version: "0.4.1" }
        },
        templating: {
          supported: true,
          wire: "template-ref/v1",
          templates: [
            {
              id: "ai.reasoning-process",
              version: "0.4.1",
              views: [
                {
                  name: "active",
                  wire_profile: "octo/v2",
                  states: ["reasoning", "answering"],
                  submit_actions: ["reasoning_stop"]
                },
                {
                  name: "error",
                  wire_profile: "octo/v2",
                  states: ["error"],
                  submit_actions: ["reasoning_retry"]
                },
                {
                  name: "result",
                  wire_profile: "octo/v1",
                  states: ["completed", "stopped"],
                  submit_actions: []
                }
              ]
            }
          ]
        }
      });
    if (url.endsWith("/bot/sendMessage") || url.endsWith("/bot/message/edit")) {
      const body = JSON.parse(options.body);
      if (body.payload?.type === 1) restReplies.push({ text: body.payload.content });
      return Response.json({ message_id: "card" });
    }
    if (url.includes("/user/info")) return Response.json({ uid: "owner", name: "Owner" });
    if (url.includes("upload/presigned"))
      return Response.json({
        method: "PUT",
        uploadUrl: `https://storage.example/upload?sig=${randomUUID()}`,
        downloadUrl: `https://cdn.example/${requests.length}.txt`
      });
    if (options.method === "PUT") return new Response(null, { status: 200 });
    throw new Error("Unexpected fixture request");
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    connection = this;
    connections.push(this);
  });
  t.mock.getter(WukongConnection.prototype, "connected", () => true);
  t.mock.method(WukongConnection.prototype, "close", async () => {});
  const config = {
    bot_id: "bot",
    api_url: "https://im.example/api",
    typing: false,
    adapter: { adapter_type: "codex", workdir: process.cwd() }
  };
  const lifetime = {
    signal: owner.signal,
    dispatcher: new ImDeliveryDispatcher(owner.signal),
    identity,
    token: () => heldToken
  };
  const transport = new GatewayTransport(
    config,
    async () => {
      credentialReads++;
      return initialToken;
    },
    {
      onMessage(message) {
        inbound = message;
      },
      onDisconnect() {}
    },
    lifetime
  );
  current = transport;
  transports.push(transport);
  await transport.start(owner.signal);
  connection.onMessage({
    messageId: "message",
    fromUid: "owner",
    channelId: "owner",
    channelType: 1,
    payload: { type: 1, content: "hello" }
  });
  t.after(async () => {
    owner.abort();
    await Promise.all(transports.map((value) => value.close()));
  });
  return {
    owner,
    transport,
    connections,
    restReplies,
    async replace(authorizeSpace) {
      heldToken = "bf_" + randomUUID();
      current = new GatewayTransport(
        config,
        async () => heldToken,
        {
          onMessage() {},
          onDisconnect() {},
          authorizeSpace
        },
        lifetime
      );
      transports.push(current);
      await current.start(owner.signal);
      return current;
    },
    initialToken,
    config,
    requests,
    inbound,
    setToken(value) {
      heldToken = value;
    },
    setHook(value) {
      hook = value;
    },
    reads() {
      return credentialReads;
    },
    sends() {
      return requests.filter(({ url }) => url.endsWith("/bot/sendMessage"));
    }
  };
}

test("REST reads the Bot-held value at profile and POST without invoking host credentials again", async (t) => {
  const f = await fixture(t);
  const profileToken = `bf_${randomUUID()}`,
    postToken = `bf_${randomUUID()}`;
  f.setToken(profileToken);
  f.setHook((url) => {
    if (url.endsWith("/bot/card/profile")) f.setToken(postToken);
  });
  await f.inbound.replyFailure(failed, "failure");
  const profile = f.requests.find(({ url }) => url.endsWith("/bot/card/profile"));
  assert.equal(new Headers(profile.options.headers).get("Authorization"), `Bearer ${profileToken}`);
  assert.equal(
    new Headers(f.sends()[0].options.headers).get("Authorization"),
    `Bearer ${postToken}`
  );
  assert.equal(f.reads(), 1, "REST cannot fetch or refresh host-managed credentials");
});

for (const value of [undefined, "malformed"]) {
  test(`missing or invalid Bot-held credential fails without HTTP: ${typeof value}`, async (t) => {
    const f = await fixture(t);
    const before = f.requests.length;
    f.setToken(value);
    await assert.rejects(
      f.inbound.replyFailure(failed, "failure"),
      new RegExp(value === undefined ? "IM_CREDENTIALS_REQUIRED" : "IM_BOT_TOKEN_INVALID")
    );
    assert.equal(f.requests.length, before);
    assert.equal(f.reads(), 1);
  });
}

for (const status of [401, 403]) {
  test(`real HTTP ${status} is reported without refreshing credentials or replaying the POST`, async (t) => {
    const f = await fixture(t);
    f.setHook((url) =>
      url.endsWith("/bot/sendMessage") ? new Response(null, { status }) : undefined
    );
    await assert.rejects(
      f.inbound.replyFailure(failed, "failure"),
      (error) => error.status === status
    );
    assert.equal(f.sends().length, 1);
    assert.equal(f.reads(), 1);
  });
}

test("existing 429 retry reads the held credential again without calling its host source", async (t) => {
  const f = await fixture(t);
  const nextToken = `bf_${randomUUID()}`;
  let lookups = 0;
  f.setHook((url) => {
    if (url.includes("/user/info") && ++lookups === 1) {
      f.setToken(nextToken);
      return new Response(null, { status: 429, headers: { "Retry-After": "0.001" } });
    }
  });
  await f.inbound.replyFinal("@[owner:Owner] done", "final");
  const requests = f.requests.filter(({ url }) => url.includes("/user/info"));
  assert.equal(requests.length, 2);
  assert.equal(
    new Headers(requests[0].options.headers).get("Authorization"),
    `Bearer ${f.initialToken}`
  );
  assert.equal(
    new Headers(requests[1].options.headers).get("Authorization"),
    `Bearer ${nextToken}`
  );
  assert.equal(f.reads(), 1);
});

test("attachments use held credentials for presign and never forward bfToken to storage", async (t) => {
  const f = await fixture(t);
  const workspace = await mkdtemp(join(tmpdir(), "octo-rest-owner-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "one.txt"), "one");
  await writeFile(join(workspace, "two.txt"), "two");
  const nextToken = `bf_${randomUUID()}`;
  let uploads = 0;
  f.setHook((url, options) => {
    if (options.method === "PUT" && ++uploads === 1) f.setToken(nextToken);
  });
  const artifacts = artifactPolicy(
    { ...f.config, artifact_delivery: { allowed_roots: [workspace] } },
    {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "workspace",
          payload: { mode: "fixed", path: workspace }
        }
      ]
    }
  );
  await f.inbound.replyFinal("[one](one.txt) [two](two.txt)", "files", {
    artifacts,
    signal: f.owner.signal,
    obsolete: () => false
  });
  const presigns = f.requests.filter(({ url }) => url.includes("upload/presigned"));
  assert.equal(presigns.length, 2);
  assert.equal(
    new Headers(presigns[1].options.headers).get("Authorization"),
    `Bearer ${nextToken}`
  );
  const puts = f.requests.filter(({ options }) => options.method === "PUT");
  assert.equal(puts.length, 2);
  assert.ok(puts.every(({ options }) => !new Headers(options.headers).has("Authorization")));
  assert.equal(
    puts[0].options.signal.aborted,
    false,
    "updating token does not cancel an existing upload"
  );
  assert.equal(f.reads(), 1);
});

// Manual-only review regressions: final cancellation is independent of WS readiness.
for (const command of ["/stop", "/reset"]) {
  test(command + " cancels pending final delivery without a fallback notice", async (t) => {
    let receive, finalOptions, release;
    let invokes = 0;
    const replies = [];
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "bot",
        api_url: "https://example.invalid",
        adapter: { adapter_type: "codex", workdir: process.cwd() }
      },
      {
        kernel: {
          async *invoke() {
            invokes++;
            yield {
              protocolVersion: 2,
              type: "message.delta",
              payload: { channel: "final", text: "done" }
            };
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          async cancelInvocation() {
            return { accepted: false };
          }
        }
      }
    );
    t.after(async () => {
      release();
      await runtime.close();
    });
    await runtime.start();
    const message = {
      messageId: "original",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "hello",
      async buildContext() {
        return { schema: "octo.context-envelope/v3", items: [] };
      },
      async reply(text) {
        replies.push(text);
      },
      async replyFinal(_text, _key, options) {
        finalOptions = options;
        await pending;
        options.signal.throwIfAborted();
        throw new ImSendError("IM_DELIVERY_UNKNOWN", "unknown");
      }
    };
    receive(message);
    await waitFor(() => finalOptions !== undefined);
    receive({ ...message, messageId: "control", text: command });
    await waitFor(() => replies.length > 0);
    const wasAborted = finalOptions.signal.aborted;
    release();
    await waitFor(() => runtime.status.workingTasks === 0);
    assert.equal(finalOptions.signal.aborted, true);
    assert.equal(finalOptions.obsolete(), true);
    assert.equal(wasAborted, true);
    assert.equal(invokes, 1);
  });
}

for (const outcome of ["cancelled", "obsolete", "deliver"]) {
  test("failure card after pending REST profile: " + outcome, async (t) => {
    const f = await fixture(t);
    const task = new AbortController();
    let release,
      entered = false,
      obsolete = false,
      profileSignal;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release());
    f.setHook(async (url, options) => {
      if (url.endsWith("/bot/card/profile")) {
        entered = true;
        profileSignal = options.signal;
        await pending;
      }
    });
    const result = f.inbound
      .replyFailure(failed, "failure", { signal: task.signal, obsolete: () => obsolete })
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error })
      );
    await waitFor(() => entered);
    if (outcome === "cancelled") task.abort();
    if (outcome === "obsolete") obsolete = true;
    release();
    const settled = await result;
    assert.equal(f.sends().length, outcome === "deliver" ? 1 : 0);
    if (outcome === "cancelled") {
      assert.equal(profileSignal.aborted, true);
      assert.equal(settled.ok, false);
    } else assert.equal(settled.ok, outcome === "deliver");
    assert.equal(f.reads(), 1);
  });
}

for (const rejection of ["bot", "space"]) {
  test(
    "explicit target rejection revokes pending and future old-task REST: " + rejection,
    async (t) => {
      const f = await fixture(t);
      let release,
        profileStarted = false,
        profileSignal,
        rejectTarget = true;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      t.after(() => release());
      f.setHook(async (url, options) => {
        if (url.endsWith("/bot/card/profile") && !profileStarted) {
          profileStarted = true;
          profileSignal = options.signal;
          await pending;
        }
        if (url.endsWith("/auth/verify-bot") && rejectTarget) {
          return Response.json({
            bot_uid: rejection === "bot" ? "other-bot" : "bot",
            space_id: "denied"
          });
        }
      });
      const inFlight = f.inbound.replyFailure(failed, "pending").then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error })
      );
      await waitFor(() => profileStarted);
      await f.transport.close();
      await assert.rejects(
        f.replace(
          rejection === "space"
            ? () => {
                throw new Error("IM_TENANT_NOT_ACTIVE");
              }
            : undefined
        ),
        new RegExp(rejection === "bot" ? "IM_BOT_IDENTITY_MISMATCH" : "IM_TENANT_NOT_ACTIVE")
      );
      const revoked = profileSignal.aborted;
      release();
      const settled = await inFlight;
      assert.equal(revoked, true);
      assert.equal(settled.ok, false);
      const before = f.requests.length;
      await assert.rejects(f.inbound.reply("later", "revoked-text"));
      await assert.rejects(f.inbound.replyFailure(failed, "later"));
      assert.equal(f.requests.length, before, "rejected target must not receive old-task HTTP");
      assert.equal(f.sends().length, 0);
      rejectTarget = false;
      await f.replace();
      const restored = f.requests.length;
      await assert.rejects(f.inbound.replyFailure(failed, "restored"));
      assert.equal(
        f.requests.length,
        restored,
        "returning to the original identity cannot revive its old scope"
      );
    }
  );
}

for (const stage of ["profile", "post"]) {
  test(
    "runtime sends usable text fallback when reconnect interrupts interaction " + stage,
    async (t) => {
      const f = await fixture(t);
      await f.transport.close();
      let release,
        entered = false,
        inInteraction = false,
        invokes = 0;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const request = {
        interactionId: "question",
        kind: "approval",
        request: { operation: { summary: "continue" } },
        expiresAt: new Date(Date.now() + 60000).toISOString()
      };
      const originalStart = GatewayTransport.prototype.start;
      t.mock.method(GatewayTransport.prototype, "start", function (signal) {
        const receive = this.callbacks.onMessage;
        this.callbacks.onMessage = (message) =>
          receive({
            ...message,
            buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] })
          });
        return originalStart.call(this, signal);
      });
      const originalInteraction = OctoConnector.prototype.interactionCard;
      t.mock.method(OctoConnector.prototype, "interactionCard", async function (...args) {
        inInteraction = true;
        try {
          return await originalInteraction.apply(this, args);
        } finally {
          inInteraction = false;
        }
      });
      f.setHook(async (url) => {
        if (
          !entered &&
          inInteraction &&
          url.endsWith(stage === "profile" ? "/bot/card/profile" : "/bot/sendMessage")
        ) {
          entered = true;
          await gate;
        }
      });
      let responded, finish;
      const answer = new Promise((resolve) => {
        finish = resolve;
      });
      const runtime = new ImRuntime(
        { ...f.config, bf_token: f.initialToken },
        {
          kernel: {
            async *invoke() {
              invokes++;
              yield { protocolVersion: 2, type: "interaction.requested", payload: request };
              await answer;
              yield {
                protocolVersion: 2,
                type: "interaction.resolved",
                payload: { interactionId: "question", status: "resolved" }
              };
              yield { protocolVersion: 2, type: "run.completed", payload: {} };
            },
            async respondInteraction(...args) {
              responded = args;
              finish();
              return { accepted: true };
            },
            async cancelInvocation() {
              finish();
              return { accepted: true };
            }
          }
        }
      );
      t.after(async () => {
        release();
        finish();
        await runtime.close();
      });
      await runtime.start();
      const first = f.connections.at(-1);
      const message = {
        messageId: "request",
        fromUid: "owner",
        channelId: "owner",
        channelType: 1,
        payload: { type: 1, content: "hello" }
      };
      first.onMessage(message);
      await waitFor(() => entered);
      first.onDisconnect(new Error("IM_DISCONNECTED"));
      await waitFor(() => f.connections.at(-1) !== first && runtime.status.state === "online");
      const replacement = f.connections.at(-1);
      release();
      await waitFor(() => f.restReplies.some((reply) => reply.text.includes("/approve question")));
      replacement.onMessage({
        ...message,
        messageId: "answer",
        payload: { type: 1, content: "/approve question" }
      });
      await waitFor(() => responded !== undefined && runtime.status.workingTasks === 0);
      assert.equal(invokes, 1);
      assert.ok(
        f.requests.some(({ url }) => url.endsWith("/bot/message/edit")),
        "created card receipt remains available for finalization"
      );
    }
  );
}

for (const rejection of ["bot", "space"]) {
  test("runtime host credential rejection blocks retained task output: " + rejection, async (t) => {
    const f = await fixture(t);
    await f.transport.close();
    let token = f.initialToken,
      inbound,
      release,
      invokes = 0,
      credentialReads = 0;
    const completion = new Promise((resolve) => {
      release = resolve;
    });
    const originalStart = GatewayTransport.prototype.start;
    t.mock.method(GatewayTransport.prototype, "start", function (signal) {
      const receive = this.callbacks.onMessage;
      this.callbacks.onMessage = (message) => {
        inbound = {
          ...message,
          buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] })
        };
        receive(inbound);
      };
      return originalStart.call(this, signal);
    });
    const runtime = new ImRuntime(f.config, {
      credentials: async () => {
        credentialReads++;
        return token;
      },
      authorizeSpace: (space) => {
        if (space !== "space") throw new Error("IM_TENANT_NOT_ACTIVE");
      },
      kernel: {
        async *invoke() {
          invokes++;
          await completion;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "done" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          release();
          return { accepted: true };
        }
      }
    });
    t.after(async () => {
      release();
      await runtime.close();
    });
    await runtime.start();
    const first = f.connections.at(-1);
    first.onMessage({
      messageId: "request",
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 1, content: "hello" }
    });
    await waitFor(() => invokes === 1);
    token = "bf_" + randomUUID();
    f.setHook((url) =>
      url.endsWith("/auth/verify-bot")
        ? Response.json({ bot_uid: rejection === "bot" ? "other-bot" : "bot", space_id: "denied" })
        : undefined
    );
    first.onDisconnect(new Error("IM_DISCONNECTED"));
    await waitFor(() => runtime.status.state === "failed");
    assert.equal(credentialReads, 2);
    const afterRejection = f.requests.length;
    await assert.rejects(inbound.replyFailure(failed, "rejected-failure"));
    await assert.rejects(inbound.reply("later", "rejected-text"));
    release();
    await waitFor(() => runtime.status.workingTasks === 0);
    assert.equal(
      f.requests.length,
      afterRejection,
      "no retained-task HTTP after explicit rejection"
    );
    assert.equal(invokes, 1);
    assert.equal(credentialReads, 2, "REST cannot refresh host credentials");
  });
}
