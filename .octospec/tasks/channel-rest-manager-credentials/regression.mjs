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
import { artifactPolicy } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifact-policy.js";

const failed = { protocolVersion: 2, type: "run.failed", payload: { message: "failure" } };

async function fixture(t) {
  const owner = new AbortController();
  const initialToken = `bf_${randomUUID()}`;
  let heldToken = initialToken,
    credentialReads = 0,
    inbound,
    connection,
    hook;
  const requests = [];
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
    if (url.endsWith("/bot/sendMessage")) return Response.json({ message_id: "card" });
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
  });
  t.mock.getter(WukongConnection.prototype, "connected", () => true);
  t.mock.method(WukongConnection.prototype, "close", async () => {});
  t.mock.method(WukongConnection.prototype, "sendText", async () => "sent");
  t.mock.method(WukongConnection.prototype, "sendFile", async () => "sent");
  const config = {
    bot_id: "bot",
    api_url: "https://im.example/api",
    typing: false,
    adapter: { adapter_type: "codex", workdir: process.cwd() }
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
    {
      signal: owner.signal,
      dispatcher: new ImDeliveryDispatcher(owner.signal),
      identity: new ImDeliveryIdentity(),
      token: () => heldToken,
      current: () => transport
    }
  );
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
    await transport.close();
  });
  return {
    owner,
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
