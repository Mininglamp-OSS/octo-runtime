import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { prepareArtifacts as prepareArtifactReply } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifacts.js";
import { artifactPolicy } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifact-policy.js";
import {
  uploadChatAttachment,
  attachmentUrl
} from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/files.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { validateImConfig } from "../packages/octo-runtime-extra-channel-gateway/dist/lifecycle/configuration.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { waitFor } from "./runtime-fixture.js";
import { ImSendError } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/text-send.js";
import { ImDeliveryDispatcher } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js";
import { ImRunProjector } from "../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { CardSession } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/card-session.js";
import { deliveryNotice } from "../packages/octo-runtime-extra-channel-gateway/dist/presentation/delivery-notice.js";

import { stableEffectKey } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { ImDeliveryIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/identity.js";

const prepareArtifacts = async (...args) => (await prepareArtifactReply(...args)).text;

const schema = "octo.context-envelope/v3";
const signal = new AbortController().signal;
const config = (workspace) => ({
  bot_id: "bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  adapter: { adapter_type: "codex", workdir: workspace }
});
const context = (workspace) => ({
  schema,
  items: [
    { namespace: "octo.execution", name: "workspace", payload: { mode: "fixed", path: workspace } }
  ]
});
async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "octo-artifacts-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return {
    workspace,
    policy: artifactPolicy(
      { ...config(workspace), artifact_delivery: { allowed_roots: [workspace] } },
      context(workspace)
    )
  };
}

function reconnectTransportFixture(t) {
  const connections = [],
    sends = [],
    files = [],
    cards = [],
    cardProfiles = [],
    closed = new Set();
  let principal = { bot_uid: "bot", space_id: "s" };
  let cardResponse;
  let onCardProfile;
  let onRequest;
  const requests = [];
  const token = `bf_${randomUUID()}`;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    options.signal?.throwIfAborted();
    requests.push({ url, options });
    const intercepted = await onRequest?.(url, options);
    if (intercepted) return intercepted;
    if (url.endsWith("/auth/verify-bot")) return Response.json(principal);
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: principal.bot_uid,
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: randomUUID()
      });
    if (url.includes("/user/info")) return Response.json({ uid: "owner", name: "Owner" });
    if (url.endsWith("/bot/events")) return Response.json({ results: [] });
    if (url.endsWith("/bot/card/profile")) {
      cardProfiles.push(url);
      await onCardProfile?.();
      const ref = { id: "ai.reasoning-process", version: "0.4.1" };
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
          reasoning_template_ref: ref
        },
        templating: {
          supported: true,
          wire: "template-ref/v1",
          templates: [
            {
              ...ref,
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
    }
    if (url.endsWith("/bot/sendMessage") || url.endsWith("/bot/message/edit")) {
      const request = { url, body: JSON.parse(options.body), signal: options.signal };
      cards.push(request);
      if (cardResponse) return cardResponse(request);
      return Response.json({ message_id: "progress-card" });
    }
    if (url.includes("upload/presigned"))
      return Response.json({
        method: "PUT",
        uploadUrl: `https://storage.example.com/game.html?sig=${randomUUID()}`,
        downloadUrl: "https://cdn.example.com/game.html"
      });
    if (url.startsWith("https://storage.example.com/")) return new Response(null, { status: 200 });
    throw Error("unexpected-request");
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    connections.push(this);
  });
  t.mock.getter(WukongConnection.prototype, "connected", function () {
    return !closed.has(this);
  });
  t.mock.method(WukongConnection.prototype, "close", async function () {
    closed.add(this);
  });
  t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
    assert.equal(closed.has(this), false, "cannot send on retired connection");
    sends.push({ connection: this, args });
    return "sent";
  });
  t.mock.method(WukongConnection.prototype, "sendFile", async function (...args) {
    assert.equal(closed.has(this), false, "cannot send file on retired connection");
    files.push({ connection: this, args });
    return "file-sent";
  });
  const message = {
    messageId: "long-task",
    fromUid: "owner",
    channelId: "owner",
    channelType: 1,
    payload: { type: 1, content: "sleep 30 seconds, then reply" }
  };
  return {
    token,
    connections,
    sends,
    files,
    cards,
    cardProfiles,
    requests,
    setRequestHook(value) {
      onRequest = value;
    },
    message,
    setCardProfileHook(value) {
      onCardProfile = value;
    },
    setCardResponse(value) {
      cardResponse = value;
    },
    setPrincipal(value) {
      principal = value;
    }
  };
}

// Exercise retained callbacks through real GatewayTransport requests and final preparation.
async function ownedTransportFixture(t) {
  const f = reconnectTransportFixture(t);
  const owner = new AbortController();
  const sockets = [];
  const transports = [];
  let current, inbound;
  const lifetime = {
    signal: owner.signal,
    dispatcher: new ImDeliveryDispatcher(owner.signal),
    identity: new ImDeliveryIdentity(),
    current: () => current
  };
  const replace = async (token = f.token, authenticate = true) => {
    const socket = new AbortController();
    sockets.push(socket);
    current = new GatewayTransport(
      { ...config(process.cwd()), typing: false },
      async () => token,
      {
        onMessage: (message) => {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    transports.push(current);
    if (authenticate) await current.start(socket.signal);
    return current;
  };
  t.after(async () => {
    owner.abort();
    await Promise.all(transports.map((transport) => transport.close()));
  });
  const first = await replace();
  f.connections[0].onMessage(f.message);
  return {
    ...f,
    owner,
    sockets,
    first,
    get inbound() {
      return inbound;
    },
    replace
  };
}

const failedRun = {
  protocolVersion: 2,
  type: "run.failed",
  payload: { code: "PROVIDER_FAILED", message: "Provider failed after reconnect" }
};

// Advance the real Runtime reconnect timer at adjacent microtask boundaries. In particular,
// cover replacement published AFTER the old authorization resolved but BEFORE its POST.
for (let microtasks = 0; microtasks <= 32; microtasks++) {
  test(`HTTP dispatch race: reconnect after ${microtasks} continuations waits for verification`, async (t) => {
    const f = reconnectTransportFixture(t);
    let inbound, beforeReplacement;
    let starts = 0;
    const originalStart = GatewayTransport.prototype.start;
    t.mock.method(GatewayTransport.prototype, "start", function (signal) {
      if (++starts === 2) beforeReplacement = f.requests.length;
      this.callbacks.onMessage = (message) => {
        inbound = message;
      };
      return originalStart.call(this, signal);
    });
    const runtime = new ImRuntime(
      { ...config(process.cwd()), bf_token: f.token, typing: false },
      {
        kernel: {
          async *invoke() {
            assert.fail("delivery must not invoke a provider");
          }
        }
      }
    );
    let release;
    const verification = new Promise((resolve) => {
      release = resolve;
    });
    t.after(async () => {
      release();
      t.mock.timers.reset();
      await runtime.close();
    });
    await runtime.start();
    f.connections[0].onMessage(f.message);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    let authenticating = false;
    f.setRequestHook(async (url) => {
      if (url.endsWith("/auth/verify-bot")) {
        authenticating = true;
        await verification;
      }
    });
    const operation = inbound.replyFailure(failedRun, "dispatch-race");
    for (let i = 0; i < microtasks; i++) await Promise.resolve();
    t.mock.timers.tick(0);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    assert.equal(authenticating, true, "real reconnect must be pending verification");
    assert.equal(
      f.requests.slice(beforeReplacement).filter(({ url }) => url.endsWith("/bot/sendMessage"))
        .length,
      0,
      "no old-token POST may start after unverified current is published"
    );
    release();
    await operation;
    assert.equal(f.cards.length, 1, "same identity resumes without duplicating the card");
  });
}

for (const path of ["failure", "notice", "progress"]) {
  for (const stage of ["before-profile", "before-write"]) {
    test(`auth recovery: ${path} waits ${stage} and sends once after verification`, async (t) => {
      const f = await ownedTransportFixture(t);
      f.sockets[0].abort();
      await f.first.close();
      let release,
        authenticating = false,
        start;
      const auth = new Promise((resolve) => {
        release = resolve;
      });
      t.after(async () => {
        release();
        await start?.catch(() => {});
      });
      f.setRequestHook(async (url) => {
        if (url.endsWith("/auth/verify-bot")) {
          authenticating = true;
          await auth;
        }
      });
      const recover = async () => {
        f.setCardProfileHook(undefined);
        const next = await f.replace(f.token, false);
        start = next.start(f.sockets.at(-1).signal);
      };
      if (stage === "before-profile") await recover();
      else f.setCardProfileHook(recover);
      let settled = false;
      const diagnostics = [];
      const operation =
        path === "failure"
          ? f.inbound.replyFailure(failedRun, "auth:failure")
          : path === "notice"
            ? f.inbound.replyDeliveryUnknown(
                deliveryNotice(),
                "auth:notice",
                "auth:final",
                f.owner.signal
              )
            : (() => {
                const presentation = f.inbound.beginPresentation(
                  "auth:progress",
                  (code) => diagnostics.push(code),
                  {}
                );
                const projector = new ImRunProjector("auth:progress");
                projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
                projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
                presentation.update(projector.snapshot());
                return presentation.finish();
              })();
      const result = operation.then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          return error;
        }
      );
      // The failed baseline can skip replyFailure entirely; do not wait indefinitely for its profile hook.
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        settled,
        false,
        "authentication must pause the operation instead of completing or failing it"
      );
      assert.equal(authenticating, true);
      assert.equal(f.cardProfiles.length, stage === "before-profile" ? 0 : 1);
      assert.equal(f.cards.length, 0);
      release();
      await start;
      assert.equal(await result, undefined);
      assert.equal(f.cards.length, 1);
      assert.deepEqual(diagnostics, []);
      assert.equal(f.cards[0].signal.aborted, false);
      if (path === "failure") assert.equal(f.cards[0].body.payload.state, "error");
      if (path === "progress") assert.equal(f.cards[0].body.payload.state, "completed");
    });
  }
}

test("HTTP dispatch race: a late ACK suppresses a notice waiting to POST", async (t) => {
  const f = await ownedTransportFixture(t);
  let release,
    start,
    authenticating = false;
  const verification = new Promise((resolve) => {
    release = resolve;
  });
  t.after(async () => {
    release();
    await start?.catch(() => {});
  });
  f.setRequestHook(async (url) => {
    if (url.endsWith("/auth/verify-bot")) {
      authenticating = true;
      await verification;
    }
  });
  f.setCardProfileHook(async () => {
    f.setCardProfileHook(undefined);
    const next = await f.replace(f.token, false);
    start = next.start(f.sockets.at(-1).signal);
  });
  const operation = f.inbound.replyDeliveryUnknown(
    deliveryNotice(),
    "late:notice",
    "late:reply",
    f.owner.signal
  );
  await waitFor(() => authenticating);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.equal(f.cards.length, 0);
  f.connections[0].onDelivered(stableEffectKey(f.first.identity, f.message, "late:reply", "text"));
  release();
  await operation;
  assert.equal(f.cards.length, 0, "a confirmed reply makes the waiting notice obsolete");
});

test("HTTP dispatch race: a rate-limited mention lookup rechecks pending identity before retry", async (t) => {
  const f = await ownedTransportFixture(t);
  let release,
    start,
    authenticating = false,
    lookups = 0;
  const verification = new Promise((resolve) => {
    release = resolve;
  });
  t.after(async () => {
    release();
    t.mock.timers.reset();
    await start?.catch(() => {});
  });
  f.setRequestHook(async (url) => {
    if (url.endsWith("/auth/verify-bot")) {
      authenticating = true;
      await verification;
    }
    if (url.includes("/user/info")) {
      if (++lookups === 1) {
        const next = await f.replace(f.token, false);
        start = next.start(f.sockets.at(-1).signal);
        return new Response("rate limited", { status: 429, headers: { "Retry-After": "0.001" } });
      }
    }
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = f.inbound.replyFinal("@[owner:Owner] done", "retry:mention");
  for (let i = 0; i < 100; i++) await Promise.resolve();
  assert.equal(authenticating, true);
  // Advance the HTTP retry while holding the replacement verification unresolved.
  t.mock.timers.tick(5);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  assert.equal(lookups, 1, "HTTP retry must not bypass the new handshake");
  release();
  await start;
  t.mock.timers.reset();
  await operation;
  assert.equal(lookups, 2);
  assert.equal(f.sends.length, 1);
});

for (const outcome of ["changed", "owner-stop", "task-stop", "failed-then-same", "timeout"]) {
  test(`auth recovery: pending notice handles ${outcome}`, async (t) => {
    const f = await ownedTransportFixture(t);
    f.sockets[0].abort();
    await f.first.close();
    const pending = await f.replace(f.token, false);
    const task = new AbortController();
    if (outcome === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    const result = f.inbound
      .replyDeliveryUnknown(deliveryNotice(), "auth:notice", "auth:final", task.signal)
      .then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          return error;
        }
      );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(f.cards.length, 0);
    if (outcome === "changed") await f.replace(`bf_${randomUUID()}`);
    else if (outcome === "owner-stop") f.owner.abort();
    else if (outcome === "task-stop") task.abort();
    else if (outcome === "timeout") t.mock.timers.tick(15000);
    else {
      f.setRequestHook((url) =>
        url.endsWith("/auth/verify-bot") ? Response.json({}, { status: 503 }) : undefined
      );
      await assert.rejects(pending.start(f.sockets.at(-1).signal));
      await pending.close();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "a failed authentication attempt must not discard the notice");
      f.setRequestHook(undefined);
      await f.replace();
    }
    const error = await result;
    if (outcome === "failed-then-same") assert.equal(error, undefined);
    else
      assert.equal(
        error?.code,
        outcome === "changed"
          ? "IM_CONNECTION_IDENTITY_CHANGED"
          : outcome === "timeout"
            ? "IM_CONNECTION_UNAVAILABLE"
            : "IM_DELIVERY_CANCELLED"
      );
    assert.equal(f.cards.length, outcome === "failed-then-same" ? 1 : 0);
  });
}

for (const stage of ["before-profile", "before-write"]) {
  test(`auth recovery: failure card respects task cancellation ${stage}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const task = new AbortController();
    if (stage === "before-profile") task.abort();
    else
      f.setCardProfileHook(() => {
        task.abort();
      });
    await assert.rejects(
      f.inbound.replyFailure(failedRun, "auth:failure", {
        signal: task.signal,
        obsolete: () => task.signal.aborted
      })
    );
    assert.equal(f.cards.length, 0);
  });
}

for (const stage of ["changed-then-pre-auth", "changed-then-original"]) {
  test(`review: old REST identity remains closed during ${stage}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const presentation = f.inbound.beginPresentation("identity-review", () => {}, {});
    const projector = new ImRunProjector("identity-review");
    projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
    presentation.update(projector.snapshot());
    await waitFor(() => f.cards.length === 1);
    await new Promise((resolve) => setImmediate(resolve));
    f.sockets[0].abort();
    await f.first.close();
    if (stage !== "pre-auth") await f.replace(`bf_${randomUUID()}`);
    await f.replace(f.token, stage === "changed-then-original");
    const count = f.cards.length;
    await assert.rejects(
      f.inbound.replyDeliveryUnknown(
        deliveryNotice(),
        "review:notice",
        "review:final",
        f.owner.signal
      )
    );
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    presentation.update(projector.snapshot());
    await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
    assert.equal(f.cards.length, count, "old identity must not resume HTTP writes");
  });
}

for (const stage of ["presign", "put"]) {
  for (const change of ["same", "changed"]) {
    test(`review: ${change} identity during artifact ${stage}`, async (t) => {
      const f = await ownedTransportFixture(t);
      const { workspace, policy } = await fixture(t);
      await writeFile(join(workspace, "one.txt"), "first");
      await writeFile(join(workspace, "two.txt"), "second");
      let switched = false,
        pendingSignal;
      f.setRequestHook(async (url, options) => {
        if (
          !switched &&
          (stage === "presign" ? url.includes("upload/presigned") : options.method === "PUT")
        ) {
          switched = true;
          pendingSignal = options.signal;
          f.sockets[0].abort();
          await f.first.close();
          await f.replace(change === "same" ? f.token : `bf_${randomUUID()}`);
        }
      });
      const result = f.inbound.replyFinal("[one](one.txt) [two](two.txt)", "review:files", {
        artifacts: policy,
        signal: f.owner.signal,
        obsolete: () => false
      });
      if (change === "same") await result;
      else await assert.rejects(result, (error) => error.code === "IM_CONNECTION_IDENTITY_CHANGED");
      assert.equal(
        pendingSignal.aborted,
        change === "changed",
        "identity cancellation reaches in-flight HTTP"
      );
      assert.equal(
        f.requests.filter((r) => r.url.includes("upload/presigned")).length,
        change === "same" ? 2 : 1
      );
      assert.equal(
        f.requests.filter((r) => r.options.method === "PUT").length,
        change === "same" ? 2 : stage === "put" ? 1 : 0
      );
      assert.equal(f.sends.length, change === "same" ? 1 : 0);
    });
  }
}

for (const creation of ["before-reconnect", "during-create"]) {
  test(`review: interaction finalization survives reconnect, created ${creation}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const diagnostics = [];
    const presentation = f.inbound.beginPresentation(
      "interaction-review",
      (code) => diagnostics.push(code),
      {}
    );
    const request = {
      interactionId: "question",
      kind: "approval",
      request: { operation: { summary: "continue" } },
      expiresAt: new Date(Date.now() + 60000).toISOString()
    };
    const reconnect = async () => {
      f.setCardProfileHook(undefined);
      f.sockets[0].abort();
      await f.first.close();
      await f.replace();
    };
    if (creation === "during-create") f.setCardProfileHook(reconnect);
    assert.equal(await presentation.interaction(request), true);
    if (creation === "before-reconnect") await reconnect();
    assert.equal(
      await presentation.interaction({ ...request, interactionId: "new-question" }),
      false,
      "retired button bindings cannot accept new interactions"
    );
    await presentation.finish();
    assert.deepEqual(diagnostics, []);
    const edit = f.cards.find((r) => r.url.endsWith("/message/edit"));
    assert.equal(edit.body.message_id, "progress-card");
    assert.match(JSON.parse(edit.body.content_edit).card.body[0].text, /invalidated/);
  });
}

test("review: confirmations from intermediate connections remain visible and suppress notices", async (t) => {
  const f = await ownedTransportFixture(t);
  const confirmations = new Map();
  t.mock.method(WukongConnection.prototype, "isDelivered", function (key) {
    return confirmations.get(this)?.has(key) ?? false;
  });
  t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
    const key = args[3];
    const keys = confirmations.get(this) ?? new Set();
    keys.add(key);
    confirmations.set(this, keys);
    this.onDelivered?.(key);
    f.sends.push({ connection: this, args });
    return "sent";
  });
  await f.first.close();
  const second = await f.replace();
  await f.inbound.reply("first", "review:first");
  await second.close();
  await f.replace();
  await f.inbound.reply("second", "review:second");
  assert.equal(f.inbound.isReplyDelivered("review:first"), true);
  await f.inbound.replyDeliveryUnknown(
    deliveryNotice(),
    "review:notice",
    "review:first",
    f.owner.signal
  );
  assert.equal(f.cards.length, 0);
  await f.inbound.reply("first", "review:first");
  assert.equal(f.sends.length, 2, "confirmed effect must not resend on the third connection");
});

test("review: identity confirmations are bounded and isolated across credential generations", () => {
  const identity = new ImDeliveryIdentity();
  const token = `bf_${randomUUID()}`;
  const first = identity.accept("bot:space", token);
  for (let i = 0; i < 513; i++) first.confirm(`effect:${i}`);
  assert.equal(first.isConfirmed("effect:0"), false);
  assert.equal(first.isConfirmed("effect:512"), true);
  assert.equal(identity.accept("bot:space", token), first);
  const second = identity.accept("bot:space", `bf_${randomUUID()}`);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isConfirmed("effect:512"), false);
  const third = identity.accept("bot:space", token);
  assert.notEqual(third, first);
  assert.equal(third.isConfirmed("effect:512"), false);
  first.confirm("late-old-ack");
  assert.equal(third.isConfirmed("late-old-ack"), false);
});

for (const failure of ["upload", "peer", "group"]) {
  test(`review: ${failure} preparation failure degrades without poisoning final delivery`, async (t) => {
    const f = await ownedTransportFixture(t);
    const { workspace, policy } = await fixture(t);
    await writeFile(join(workspace, "one.txt"), "first");
    await writeFile(join(workspace, "two.txt"), "second");
    // Use a fresh group callback for the member-list branch.
    if (failure === "group") {
      // Accept direct/group messages under the same fixture configuration.
      f.connections[0].onMessage({
        ...f.message,
        channelType: 2,
        channelId: "group",
        payload: { type: 1, content: "@bot final", mention: { uids: ["bot"] } }
      });
    }
    let failed = false;
    f.setRequestHook(async (url) => {
      if (
        !failed &&
        (failure === "upload"
          ? url.includes("filename=two.txt")
          : failure === "peer"
            ? url.includes("/user/info")
            : url.includes("/groups/group/members"))
      ) {
        failed = true;
        throw new TypeError("temporary network loss");
      }
      if (url.includes("/groups/group/members")) return Response.json({ members: [] });
    });
    // An ACK-unknown outcome must not cause the completed uploads to run again.
    let attempts = 0;
    t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
      f.sends.push({ connection: this, args });
      if (++attempts === 1) throw new ImSendError("IM_DISCONNECTED", "unknown");
      return "sent";
    });
    const options = { artifacts: policy, signal: f.owner.signal, obsolete: () => false };
    const text = "[one](one.txt) [two](two.txt) @[owner:Owner]";
    await assert.rejects(
      f.inbound.replyFinal(text, "review:preparation", options),
      (error) => error.state === "unknown"
    );
    await f.inbound.replyFinal(text, "review:preparation", options);
    assert.equal(failed, true);
    assert.equal(f.sends.length, 2, "preparation failure must not prevent sending the body");
    assert.equal(
      f.requests.filter((r) => r.url.includes("upload/presigned")).length,
      2,
      "successful uploads stay cached"
    );
    if (failure === "upload") assert.match(f.sends.at(-1).args[2], /Attachment delivery failed/);
    else assert.match(f.sends.at(-1).args[2], /@Owner/);
  });
}

for (const scenario of ["token", "api", "space", "bot", "same", "rest-only"]) {
  for (const stage of ["before-profile", "before-send"]) {
    test(`unknown delivery notice identity: ${scenario} ${stage}`, async (t) => {
      const f = reconnectTransportFixture(t);
      const owner = new AbortController();
      let current, inbound;
      const lifetime = {
        signal: owner.signal,
        dispatcher: new ImDeliveryDispatcher(owner.signal),
        identity: new ImDeliveryIdentity(),
        current: () => current
      };
      const first = new GatewayTransport(
        { ...config(process.cwd()), typing: false },
        async () => f.token,
        {
          onMessage(message) {
            inbound = message;
          },
          onDisconnect() {}
        },
        lifetime
      );
      current = first;
      t.after(async () => {
        owner.abort();
        await first.close();
        await current?.close();
      });
      await first.start(owner.signal);
      f.connections[0].onMessage(f.message);
      t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
        f.sends.push({ connection: this, args });
        throw new ImSendError("IM_DISCONNECTED", "unknown");
      });
      await assert.rejects(
        inbound.replyFinal("done", "final:unknown"),
        (error) => error.state === "unknown"
      );
      await first.close();
      current = undefined;
      const recover = async () => {
        if (scenario === "rest-only") return;
        f.setPrincipal({
          bot_uid: scenario === "bot" ? "other" : "bot",
          space_id: scenario === "space" ? "other" : "s"
        });
        current = new GatewayTransport(
          {
            ...config(process.cwd()),
            typing: false,
            ...(scenario === "api" ? { api_url: "https://other.example/api" } : {}),
            ...(scenario === "bot" ? { bot_id: "other" } : {})
          },
          async () => (scenario === "token" ? `bf_${randomUUID()}` : f.token),
          { onMessage() {}, onDisconnect() {} },
          lifetime
        );
        await current.start(owner.signal);
      };
      if (stage === "before-profile") await recover();
      else f.setCardProfileHook(recover);
      const notice = inbound.replyDeliveryUnknown(
        deliveryNotice(),
        "notice:unknown",
        "final:unknown",
        owner.signal
      );
      if (["same", "rest-only"].includes(scenario)) {
        await notice;
        assert.equal(f.cardProfiles.length, 1);
        assert.equal(f.cards.length, 1);
        assert.equal(f.cards[0].body.payload.card.body[0].text, "回复送达结果未知");
      } else {
        await assert.rejects(
          notice,
          (error) => error.code === "IM_CONNECTION_IDENTITY_CHANGED" && error.state === "failed"
        );
        assert.equal(
          f.cardProfiles.length,
          stage === "before-profile" ? 0 : 1,
          "guard applies before every REST request"
        );
        assert.equal(f.cards.length, 0, "no delivery notice may mutate a retired identity");
      }
      assert.equal(f.sends.length, 1, "unknown final must not be replayed");
    });
  }
}

test("long task invokes once, completes its original REST card and sends final after WS recovery", async (t) => {
  const f = reconnectTransportFixture(t);
  const releaseCard = t.mock.method(CardSession.prototype, "release");
  const originalStart = GatewayTransport.prototype.start;
  t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
    const receive = this.callbacks.onMessage;
    // 保留真实回复、REST 卡片与 Runtime 恢复，仅隔离与本次验证无关的上下文读取。
    this.callbacks.onMessage = (message) =>
      receive({
        ...message,
        buildContext: async () => ({ schema, items: [] })
      });
    return originalStart.call(this, signal);
  });
  let release,
    invokes = 0;
  const completion = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = new ImRuntime(
    { ...config(process.cwd()), bf_token: f.token, typing: false },
    {
      kernel: {
        async *invoke() {
          invokes++;
          yield { protocolVersion: 2, type: "run.started", payload: {} };
          await completion;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "done after sleep" }
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
  f.connections[0].onMessage(f.message);
  await waitFor(() => invokes === 1);
  await waitFor(() => f.cards.length === 1);
  f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
  await waitFor(() => f.connections.length === 2 && runtime.status.state === "online");
  assert.equal(releaseCard.mock.callCount(), 0, "reconnection must preserve the running REST card");
  release();
  await waitFor(() => runtime.status.workingTasks === 0);
  assert.equal(invokes, 1);
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].connection, f.connections[1]);
  assert.equal(f.sends[0].args[0], "owner");
  assert.equal(f.sends[0].args[2], "done after sleep");
  assert.equal(f.cards.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
  assert.equal(f.cards.at(-1).body.message_id, "progress-card");
  assert.equal(f.cards.at(-1).body.state, "completed");
  assert.equal(f.cards.at(-1).body.transient, undefined);
  assert.equal(
    releaseCard.mock.callCount(),
    1,
    "task finalization releases the original card once"
  );
  assert.equal(
    runtime.status.cardDeliveries,
    f.cards.length,
    "all retained card receipts remain visible after reconnect"
  );
});

for (const command of ["/stop", "/reset"]) {
  test(`empty final waiting for WS recovery respects ${command}`, async (t) => {
    const f = reconnectTransportFixture(t);
    let releaseTask,
      releaseReconnect,
      started = 0,
      invokes = 0,
      replyStarted = false;
    const completion = new Promise((resolve) => {
      releaseTask = resolve;
    });
    const reconnect = new Promise((resolve) => {
      releaseReconnect = resolve;
    });
    const originalStart = GatewayTransport.prototype.start;
    t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
      if (++started === 2) await reconnect;
      const receive = this.callbacks.onMessage;
      this.callbacks.onMessage = (message) =>
        receive({
          ...message,
          buildContext: async () => ({ schema, items: [] }),
          reply: (...args) => {
            if (args[0] === "执行已结束，未返回文本。") replyStarted = true;
            return message.reply(...args);
          }
        });
      return originalStart.call(this, signal);
    });
    const runtime = new ImRuntime(
      { ...config(process.cwd()), bf_token: f.token, cards: false, typing: false },
      {
        kernel: {
          async *invoke() {
            invokes++;
            yield { protocolVersion: 2, type: "run.started", payload: {} };
            await completion;
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          async cancelInvocation() {
            return { accepted: false };
          }
        }
      }
    );
    t.after(async () => {
      releaseTask();
      releaseReconnect();
      await runtime.close();
    });
    await runtime.start();
    f.connections[0].onMessage(f.message);
    await waitFor(() => invokes === 1);
    f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
    releaseTask();
    await waitFor(() => replyStarted);
    assert.equal(f.sends.length, 0, "terminal notice must be waiting for recovery");
    releaseReconnect();
    await waitFor(() => f.connections.length === 2 && runtime.status.state === "online");
    f.connections[1].onMessage({
      ...f.message,
      messageId: `control-${command}`,
      payload: { type: 1, content: command }
    });
    await waitFor(() => runtime.status.workingTasks === 0 && f.sends.length > 0);
    assert.equal(invokes, 1);
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].args[2], command === "/stop" ? "已请求停止本轮执行。" : "会话已经重置");
  });
}

for (const scenario of ["rest-only", "recovered", "in-flight", "stop", "identity", "transient"]) {
  test(`REST progress card lifetime across WS close: ${scenario}`, async (t) => {
    const f = reconnectTransportFixture(t);
    const owner = new AbortController();
    const oldSocket = new AbortController();
    let current, inbound;
    const lifetime = {
      signal: owner.signal,
      dispatcher: new ImDeliveryDispatcher(owner.signal),
      identity: new ImDeliveryIdentity(),
      current: () => current
    };
    const first = new GatewayTransport(
      { ...config(process.cwd()), typing: false },
      async () => f.token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    current = first;
    t.after(async () => {
      owner.abort();
      await first.close();
      await current?.close();
    });
    await first.start(oldSocket.signal);
    f.connections[0].onMessage(f.message);
    const diagnostics = [];
    const presentation = inbound.beginPresentation(
      "long-task",
      (code) => diagnostics.push(code),
      {}
    );
    const projector = new ImRunProjector("long-task");
    projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
    presentation.update(projector.snapshot());
    await waitFor(() => f.cards.length === 1);
    await new Promise((resolve) => setImmediate(resolve));
    let release, pendingSignal;
    if (scenario === "in-flight" || scenario === "stop") {
      f.setCardResponse(
        ({ signal }) =>
          new Promise((resolve, reject) => {
            pendingSignal = signal;
            const abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            release = () => {
              signal.removeEventListener("abort", abort);
              resolve(Response.json({}));
            };
          })
      );
      presentation.update(projector.snapshot());
      await waitFor(() => pendingSignal);
    }
    oldSocket.abort();
    await first.close();
    current = undefined;
    assert.equal(f.cards[0].signal.aborted, false, "WS teardown must not cancel REST");
    if (pendingSignal) {
      assert.equal(pendingSignal.aborted, false, "in-flight REST must survive WS teardown");
      if (scenario === "stop") {
        owner.abort();
        assert.equal(pendingSignal.aborted, true, "Bot stop cancels REST");
        projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
        presentation.update(projector.snapshot());
        await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
        assert.equal(f.cards.length, 2);
        return;
      }
      release();
      f.setCardResponse(undefined);
    }
    if (scenario === "recovered" || scenario === "identity") {
      current = new GatewayTransport(
        { ...config(process.cwd()), typing: false },
        async () => (scenario === "identity" ? `bf_${randomUUID()}` : f.token),
        { onMessage() {}, onDisconnect() {} },
        lifetime
      );
      assert.equal(
        current.status.cardDeliveries,
        1,
        "retained receipts remain visible before new transport authentication"
      );
      await current.start(owner.signal);
    }
    if (scenario === "rest-only" || scenario === "transient") {
      if (scenario === "transient")
        f.setCardResponse(() => {
          throw new TypeError("network changed");
        });
      presentation.update(projector.snapshot());
      await waitFor(() => f.cards.length === 2);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.connections.length, 1, "REST must not wait for a replacement WS");
      f.setCardResponse(undefined);
    }
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    presentation.update(projector.snapshot());
    if (scenario === "identity") {
      await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
      assert.equal(f.cards.length, 1, "identity change must stop old-card HTTP requests");
      return;
    }
    await presentation.finish();
    const terminalCount = f.cards.length;
    presentation.update({ ...projector.snapshot(), terminal: undefined, phase: "thinking" });
    await presentation.finish();
    assert.equal(f.cards.length, terminalCount, "late progress must not overwrite terminal");
    assert.equal(f.cards.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
    assert.ok(f.cards.slice(1).every((r) => r.body.message_id === "progress-card"));
    assert.equal(f.cards.at(-1).body.state, "completed");
    assert.equal(f.cards.at(-1).body.transient, undefined);
    assert.ok(f.cards.slice(1).every((r, i) => r.body.card_seq === i + 2));
    if (scenario !== "transient") assert.deepEqual(diagnostics, []);
  });
}

for (const scenario of [
  "recovered",
  "file",
  "stop",
  "timeout",
  "token",
  "space",
  "bot",
  "api",
  "unknown"
]) {
  test(`final delivery after reconnect: ${scenario}`, async (t) => {
    const f = reconnectTransportFixture(t);
    const owner = new AbortController();
    let current, inbound;
    const lifetime = {
      signal: owner.signal,
      dispatcher: new ImDeliveryDispatcher(owner.signal),
      identity: new ImDeliveryIdentity(),
      current: () => current
    };
    const first = new GatewayTransport(
      config(process.cwd()),
      async () => f.token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    current = first;
    const oldSignal = new AbortController();
    await first.start(oldSignal.signal);
    f.connections[0].onMessage(f.message);
    oldSignal.abort();
    await first.close();
    current = undefined;
    t.after(() => {
      owner.abort();
    });
    let text = "done",
      options;
    if (scenario === "file") {
      const { workspace, policy } = await fixture(t);
      await writeFile(join(workspace, "game.html"), "html");
      text = "[Game](game.html)";
      options = { artifacts: policy, signal: owner.signal, obsolete: () => false };
    }
    if (scenario === "timeout") {
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
      t.mock.method(performance, "now", () => Date.now());
    }
    const reply = inbound.replyFinal(text, "final:long-task", options).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.sends.length, 0);
    if (scenario === "timeout") {
      t.mock.timers.tick(15000);
      assert.equal((await reply).code, "IM_CONNECTION_UNAVAILABLE");
      assert.equal(f.sends.length, 0);
      return;
    }
    if (scenario === "stop") {
      owner.abort();
      assert.equal((await reply).code, "IM_DELIVERY_CANCELLED");
      return;
    }
    f.setPrincipal({
      bot_uid: scenario === "bot" ? "other" : "bot",
      space_id: scenario === "space" ? "other" : "s"
    });
    const nextConfig = {
      ...config(process.cwd()),
      ...(scenario === "bot" ? { bot_id: "other" } : {}),
      ...(scenario === "api" ? { api_url: "https://other.example/api" } : {})
    };
    current = new GatewayTransport(
      nextConfig,
      async () => (scenario === "token" ? `bf_${randomUUID()}` : f.token),
      { onMessage() {}, onDisconnect() {} },
      lifetime
    );
    t.after(() => current.close());
    await current.start(owner.signal);
    if (scenario === "unknown") {
      t.mock.method(WukongConnection.prototype, "sendText", async function (...args) {
        f.sends.push({ connection: this, args });
        throw new ImSendError("IM_DISCONNECTED", "unknown");
      });
    }
    const result = await reply;
    if (["token", "space", "bot", "api"].includes(scenario)) {
      assert.equal(result.code, "IM_CONNECTION_IDENTITY_CHANGED");
      assert.equal(result.state, "failed");
      assert.equal(f.sends.length, 0);
    } else if (scenario === "unknown") {
      assert.equal(result.state, "unknown");
      let attempts = 0;
      const receipt = await new ImDeliveryDispatcher(owner.signal).deliver(
        "final:unknown",
        async () => {
          attempts++;
          throw result;
        }
      );
      assert.equal(receipt.state, "unknown");
      assert.equal(attempts, 1);
      assert.equal(f.sends.length, 1);
    } else {
      assert.equal(result, undefined);
      assert.equal(f.sends.length, 1);
      assert.equal(f.sends[0].connection, f.connections[1]);
      if (scenario === "file") {
        assert.equal(f.files.length, 1);
        assert.equal(f.files[0].connection, f.connections[1]);
        assert.equal(
          current.status.cardDeliveries,
          1,
          "file receipt is retained in Bot card statistics"
        );
        assert.match(f.sends[0].args[2], /https:\/\/cdn.example.com\/game.html/);
      }
    }
  });
}

test("HTML games, arbitrary files and mixed images retain exact Markdown while realpaths upload once", async (t) => {
  const { workspace, policy } = await fixture(t);
  const uploads = [];
  for (const name of [
    "game.html",
    "report.pdf",
    "deck.pptx",
    "notes.md",
    "unknown.custom",
    "a.png",
    "a.jpg",
    "a.webp",
    "a.gif",
    "a.svg",
    "a.bmp",
    "a.tiff",
    "space name.txt"
  ])
    await writeFile(join(workspace, name), `bytes:${name}`);
  await symlink(join(workspace, "a.png"), join(workspace, "alias.png"));
  const text = [
    "# Outputs",
    '[**Play**](./game.html "Game title") and [PDF](./report.pdf)',
    "[deck](./deck.pptx) [notes](./notes.md) [custom](unknown.custom)",
    '![alt](./a.png "image title") [download](./alias.png)',
    "![photo][PHOTO] and [game][game]",
    "[PHOTO]: <./a.jpg> 'Photo title'",
    '[game]: ./game.html "Game"',
    "![webp](a.webp) ![gif](a.gif) ![svg](a.svg) ![bmp](a.bmp) ![tiff](a.tiff)",
    "[spaces](<./space name.txt>)",
    `[absolute](${join(workspace, "notes.md")}) [url](${pathToFileURL(join(workspace, "notes.md"))})`,
    "[cloud](https://cdn.example.com/already.pdf) ![remote](https://cdn.example.com/image.png)",
    "[unused]: ./never-uploaded.txt"
  ].join("\n\n");
  const result = await prepareArtifacts(text, policy, signal, async (bytes, name, mime) => {
    uploads.push({ name, mime });
    assert.equal(Buffer.from(bytes).toString(), `bytes:${name}`);
    return `https://cdn.example.com/${encodeURIComponent(name)}`;
  });
  let expected = text;
  for (const name of ["game.html", "report.pdf", "deck.pptx", "notes.md", "a.png", "a.jpg"])
    expected = expected.replaceAll(`./${name}`, `https://cdn.example.com/${name}`);
  expected = expected.replace("./alias.png", "https://cdn.example.com/a.png");
  expected = expected.replace("unknown.custom", "https://cdn.example.com/unknown.custom");
  for (const name of ["a.webp", "a.gif", "a.svg", "a.bmp", "a.tiff"])
    expected = expected.replace(`](${name})`, `](https://cdn.example.com/${name})`);
  expected = expected.replace("./space name.txt", "https://cdn.example.com/space%20name.txt");
  expected = expected.replace(join(workspace, "notes.md"), "https://cdn.example.com/notes.md");
  expected = expected.replace(
    pathToFileURL(join(workspace, "notes.md")).href,
    "https://cdn.example.com/notes.md"
  );
  assert.equal(result, expected);
  assert.equal(uploads.length, 13);
  assert.equal(uploads.find((u) => u.name === "unknown.custom").mime, "application/octet-stream");
  assert.equal(uploads.find((u) => u.name === "a.tiff").mime, "image/tiff");
});

test("code, HTML, quotes and unused definitions are untouched, including definitions shared with examples", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "a.png"), "image");
  const examples =
    "`[code](./a.png)`\n\n```md\n![code](./a.png)\n```\n\n> ![quote][r]\n\n<div>\n[html](./a.png)\n</div>";
  const text = `${examples}\n\n![*live*][r] ![inline](./a.png)\n\n[r]: <./a.png> 'keep title'\n\n[unused]: ./other.txt`;
  let uploads = 0;
  const result = await prepareArtifacts(text, policy, signal, async () => {
    uploads++;
    return "https://cdn.example.com/a.png";
  });
  assert.equal(uploads, 1);
  assert.equal(
    result,
    text
      .replace("![*live*][r]", "![*live*](<https://cdn.example.com/a.png> 'keep title')")
      .replace("![inline](./a.png)", "![inline](https://cdn.example.com/a.png)")
  );
  assert.equal(
    await prepareArtifacts(examples, policy, signal, () => {
      throw Error("must not upload");
    }),
    examples
  );
});

test("protected reference expansions retain nested image uploads without overlapping edits", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "a.png"), "image");
  await writeFile(join(workspace, "game.html"), "game");
  for (const image of ["![alt](./a.png)", "![alt][image]"]) {
    const text = `> [example][game]\n\n> ![example][image]\n\n[${image} play][game]\n\n[game]: ./game.html 'Play'\n\n[image]: ./a.png 'Image'`;
    const uploads = [];
    const result = await prepareArtifacts(text, policy, signal, async (_bytes, name) => {
      uploads.push(name);
      return `https://cdn.example.com/${name}`;
    });
    const nested = image.includes("[image]")
      ? "![alt](<https://cdn.example.com/a.png> 'Image')"
      : "![alt](https://cdn.example.com/a.png)";
    assert.equal(
      result,
      text.replace(
        `[${image} play][game]`,
        `[${nested} play](<https://cdn.example.com/game.html> 'Play')`
      )
    );
    assert.deepEqual(uploads.sort(), ["a.png", "game.html"]);
  }
});

test("partial failure preserves successful URLs and reports inaccessible, forbidden and non-file paths", async (t) => {
  const { workspace, policy } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "octo-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.txt"), "private");
  await symlink(join(outside, "secret.txt"), join(workspace, "escape.txt"));
  await mkdir(join(workspace, "directory"));
  await writeFile(join(workspace, "good.html"), "game");
  const calls = [];
  const upload = async (_bytes, name) => {
    calls.push(name);
    return "https://cdn.example.com/good.html";
  };
  const text = `[good](good.html) [missing](missing.pdf) [escape](escape.txt) [dir](directory) [outside](${join(outside, "secret.txt")}) [windows](C:/provider/out.pdf)`;
  const result = await prepareArtifacts(text, policy, signal, upload);
  assert.deepEqual(calls, ["good.html"]);
  assert.match(result, /\[good\]\(https:\/\/cdn.example.com\/good.html\)/);
  for (const reason of [
    "file-unavailable",
    "directory-policy",
    "not-regular-file",
    "path-unavailable"
  ])
    assert.ok(result.includes(reason), reason);
  assert.match(result, /generation was not rerun/);
});

test("size, total, count, MIME and root policies reject before transfer", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "one.txt"), "1234");
  await writeFile(join(workspace, "two.txt"), "1234");
  for (const [override, reason, expectedCalls] of [
    [{ maxFileBytes: 3 }, "file-size-limit", 0],
    [{ maxTotalBytes: 5 }, "total-size-limit", 1],
    [{ maxFiles: 1 }, "file-count-limit", 1],
    [{ mimeTypes: [] }, "type-policy", 0],
    [{ roots: [] }, "directory-policy", 0]
  ]) {
    let calls = 0;
    const output = await prepareArtifacts(
      "[one](one.txt) [two](two.txt)",
      { ...policy, ...override },
      signal,
      async () => {
        calls++;
        return "https://cdn.example.com/file";
      }
    );
    assert.equal(calls, expectedCalls);
    assert.ok(output.includes(reason));
  }
});

test("upload failure is cached across aliases and owner cancellation stops preparation", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "file.txt"), "bytes");
  let calls = 0;
  const failure = await prepareArtifacts(
    "[a](file.txt) [b](./file.txt)",
    policy,
    signal,
    async () => {
      calls++;
      throw new Error("service-rejected");
    }
  );
  assert.equal(calls, 1);
  assert.match(failure, /service-rejected/);
  const owner = new AbortController();
  const operation = prepareArtifacts(
    "[a](file.txt)",
    policy,
    owner.signal,
    async (_bytes, _name, _mime, uploadSignal) => {
      owner.abort();
      uploadSignal.throwIfAborted();
    }
  );
  await assert.rejects(operation, { name: "AbortError" });
  const timed = await prepareArtifacts(
    "[a](file.txt)",
    { ...policy, timeoutMs: 5 },
    signal,
    async (_bytes, _name, _mime, uploadSignal) => {
      await new Promise((_resolve, reject) =>
        uploadSignal.addEventListener("abort", () => reject(uploadSignal.reason), { once: true })
      );
    }
  );
  assert.match(timed, /delivery-timeout/);
});

test("chat upload uses signed PUT headers and exposes only the persistent download URL", async (t) => {
  const token = `bf_${randomUUID()}`;
  const uploadUrl = `https://storage.example.com/object?signature=${randomUUID()}`;
  for (const downloadUrl of ["https://cdn.example.com/chat/game.html", "assets/game.html"]) {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(init.redirect, "error");
      if (init.method === "GET") {
        assert.equal(new URL(url).pathname, "/api/v1/bot/upload/presigned");
        assert.equal(new URL(url).searchParams.get("filename"), "game.html");
        assert.equal(new URL(url).searchParams.get("fileSize"), "17");
        assert.equal(init.headers.Authorization, `Bearer ${token}`);
        return Response.json({
          method: "PUT",
          uploadUrl,
          downloadUrl,
          contentType: "text/html; charset=utf-8",
          contentDisposition: "attachment; filename=game.html",
          maxFileSize: 17,
          expiredTime: Math.floor(Date.now() / 1000) + 60
        });
      }
      puts++;
      assert.equal(init.method, "PUT");
      assert.equal(url, uploadUrl);
      assert.deepEqual(init.headers, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "attachment; filename=game.html"
      });
      assert.equal(Buffer.from(init.body).toString(), "<html>game</html>");
      return new Response(null, { status: 200 });
    });
    const url = await uploadChatAttachment(
      config().api_url,
      token,
      Buffer.from("<html>game</html>"),
      "game.html",
      "text/html",
      signal
    );
    assert.equal(
      url,
      downloadUrl.startsWith("https:")
        ? downloadUrl
        : "https://im-test.deepminer.com.cn/api/assets/game.html"
    );
    assert.equal(puts, 1);
  }
  for (const raw of [
    "file:///secret",
    "javascript:evil",
    `https://${randomUUID()}:${randomUUID()}@cdn.example.com/a`,
    `https://cdn.example.com/a?X-Amz-Signature=${randomUUID()}`,
    "file/preview/chat/a.html",
    "/v1/bot/file/download/a",
    "/api/v1/botfile/chat/a.html"
  ])
    assert.throws(() => attachmentUrl(raw, config().api_url));
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(65537)));
  await assert.rejects(
    uploadChatAttachment(config().api_url, token, Buffer.from("x"), "a.txt", "text/plain", signal),
    /byte limit/
  );
});

test("invalid or expired upload grants are rejected before any bytes leave Gateway", async (t) => {
  const valid = {
    method: "PUT",
    uploadUrl: `https://storage.example.com/object?sig=${randomUUID()}`,
    downloadUrl: "https://cdn.example.com/a.txt",
    contentType: "text/plain",
    maxFileSize: 1
  };
  for (const override of [
    { method: "POST" },
    { uploadUrl: "http://storage.example.com/object" },
    { uploadUrl: `https://${randomUUID()}:${randomUUID()}@storage.example.com/object` },
    { downloadUrl: `https://cdn.example.com/a.txt?sig=${randomUUID()}` },
    { downloadUrl: "/v1/botfile/chat/a.txt" },
    { maxFileSize: 2 },
    { expiredTime: Math.floor(Date.now() / 1000) - 1 },
    { contentType: `text/plain\r\nAuthorization: ${randomUUID()}` },
    { contentDisposition: `attachment\r\nAuthorization: ${randomUUID()}` }
  ]) {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests++;
      assert.equal(init.method, "GET");
      return Response.json({ ...valid, ...override });
    });
    await assert.rejects(
      uploadChatAttachment(
        config().api_url,
        `bf_${randomUUID()}`,
        Buffer.from("x"),
        "a.txt",
        "text/plain",
        signal
      )
    );
    assert.equal(requests, 1);
  }
});

test("invocation establishes the contract before execution and cannot accept forged access policy from Context", async () => {
  for (const mode of [undefined, "tools"]) {
    const bot = {
      ...config(process.cwd()),
      artifact_delivery: { allowed_roots: [process.cwd()], ...(mode ? { mode } : {}) }
    };
    const submitted = {
      schema,
      items: [
        { namespace: "extra.im", name: "artifact-delivery", payload: { allowedRoots: ["/"] } }
      ]
    };
    const original = structuredClone(submitted);
    const { request } = createImInvocation(
      bot,
      { messageId: "m", text: "Create a game" },
      submitted,
      "key",
      { id: "session", generation: 1 },
      signal
    );
    const contract = request.contexts.items.find((item) => item.name === "artifact-delivery");
    assert.equal(contract.payload.mode, mode ?? "channel");
    assert.deepEqual(contract.payload.allowedRoots, [process.cwd()]);
    if (mode) assert.match(contract.guidance, /does not automatically upload/);
    else {
      assert.equal(
        contract.guidance,
        "If your final deliverable is a local file, reference it using Markdown with an absolute path: [label](/absolute/path); for images, use ![alt](/absolute/path)."
      );
      assert.doesNotMatch(contract.guidance, /upload|tool calls|Do not send|publish/);
    }
    assert.deepEqual(submitted, original);
  }
  const noUpload = "[cloud](https://cdn.example.com/game.html)";
  assert.equal(
    await prepareArtifacts(noUpload, { mode: "tools" }, signal, () => {
      throw Error();
    }),
    noUpload
  );
  for (const invalid of [
    null,
    { mode: "guess" },
    { allowed_roots: ["relative"] },
    { max_file_bytes: 999999999 },
    { allowed_mime_types: ["*"] }
  ])
    assert.throws(
      () => validateImConfig({ ...config(process.cwd()), artifact_delivery: invalid }),
      /ARTIFACT_CONFIG/
    );
});

test("invocation freezes delivery mode and allowed roots before SDK configuration changes", () => {
  const bot = {
    ...config(process.cwd()),
    artifact_delivery: { allowed_roots: [process.cwd()] }
  };
  const prepared = createImInvocation(
    bot,
    { messageId: "m", text: "Output" },
    context(process.cwd()),
    "key",
    { id: "session", generation: 1 },
    signal
  );
  bot.artifact_delivery.mode = "tools";
  bot.artifact_delivery.allowed_roots.push(tmpdir());
  assert.equal(prepared.artifacts.mode, "channel");
  assert.deepEqual(prepared.artifacts.roots, [process.cwd()]);
  assert.deepEqual(
    prepared.request.contexts.items.find((item) => item.name === "artifact-delivery").payload
      .allowedRoots,
    [process.cwd()]
  );
});

for (const cardState of ["failed", "unknown"]) {
  test(`transport preserves links and sends native cards once across text retries, with explicit ${cardState} card receipts`, async (t) => {
    const { workspace, policy } = await fixture(t);
    await writeFile(join(workspace, "game.html"), "html");
    await writeFile(join(workspace, "notes.md"), "markdown");
    await writeFile(join(workspace, "image.png"), "image");
    const token = `bf_${randomUUID()}`;
    let receive,
      inbound,
      uploads = 0;
    const sends = [];
    const cards = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/auth/verify-bot")) return Response.json({ bot_uid: "bot", space_id: "s" });
      if (url.endsWith("/bot/register"))
        return Response.json({
          robot_id: "bot",
          ws_url: "wss://im-test.deepminer.com.cn/ws",
          im_token: randomUUID()
        });
      if (url.includes("upload/presigned")) {
        const name = new URL(url).searchParams.get("filename");
        return Response.json({
          method: "PUT",
          uploadUrl: `https://storage.example.com/${name}?sig=${randomUUID()}`,
          downloadUrl: `https://cdn.example.com/chat/generated-${name}`
        });
      }
      if (url.startsWith("https://storage.example.com/")) {
        uploads++;
        return new Response(null, { status: 200 });
      }
      if (url.includes("/user/info"))
        return Response.json({ uid: "owner", name: "Owner", robot: false });
      throw new Error("unexpected-request");
    });
    t.mock.method(WukongConnection.prototype, "connect", async function () {
      receive = this.onMessage;
    });
    t.mock.getter(WukongConnection.prototype, "connected", () => true);
    t.mock.method(WukongConnection.prototype, "close", async () => {});
    t.mock.method(WukongConnection.prototype, "sendFile", async (...args) => {
      cards.push(args);
      if (args[2].name === "notes.md") throw new ImSendError("IM_SEND_TEST_RECEIPT", cardState);
      return "file-sent";
    });
    t.mock.method(WukongConnection.prototype, "sendText", async (...args) => {
      sends.push(args);
      if (sends.length === 1) throw new Error("retry");
      return "sent";
    });
    const transport = new GatewayTransport(
      { ...config(workspace), cards: false },
      async () => token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      }
    );
    await transport.start(signal);
    t.after(() => transport.close());
    receive({
      messageId: "m",
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 1, content: "create a game" }
    });
    const text =
      "[Play](game.html) [Again](./game.html) [Notes][n] ![Image](image.png) @[owner:Owner]\n\n[n]: notes.md";
    const options = {
      artifacts: policy,
      signal,
      obsolete: () => false
    };
    await assert.rejects(inbound.replyFinal(text, "final:run", options), /retry/);
    await inbound.replyFinal(text, "final:run", options);
    assert.equal(uploads, 3);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[0][2], {
      url: "https://cdn.example.com/chat/generated-game.html",
      name: "game.html",
      size: 4,
      extension: "html"
    });
    assert.notEqual(cards[0][3], cards[1][3]);
    assert.equal(transport.status.cardDeliveries, 2);
    assert.equal(sends.length, 2);
    assert.equal(sends[0][3], sends[1][3]);
    assert.ok(sends[1][2].startsWith("[Play](https://cdn.example.com/chat/generated-game.html)"));
    assert.match(sends[1][2], /\[Again\]\(https:\/\/cdn.example.com\/chat\/generated-game.html\)/);
    assert.match(sends[1][2], /!\[Image\]\(https:\/\/cdn.example.com\/chat\/generated-image.png\)/);
    assert.match(sends[1][2], /\[n\]: https:\/\/cdn.example.com\/chat\/generated-notes.md/);
    assert.match(
      sends[1][2],
      new RegExp(
        `File card delivery unconfirmed: notes.md \\(${cardState}: IM_SEND_TEST_RECEIPT\\)`
      )
    );
    const mention = sends[1][5].entities[0];
    assert.equal(sends[1][2].slice(mention.offset, mention.offset + mention.length), "@Owner");
    await inbound.replyFinal(
      "[Already uploaded](https://cdn.example.com/tool.html)",
      "final:tool",
      options
    );
    assert.equal(uploads, 3);
    assert.equal(cards.length, 2);
  });
}

test("native card preparation follows ordinary link usage while images stay inline and aliases share one upload", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "image.png"), "image");
  await symlink(join(workspace, "image.png"), join(workspace, "alias.png"));
  let uploads = 0;
  const upload = async () => {
    uploads++;
    return "https://cdn.example.com/image.png";
  };
  const imageOnly = await prepareArtifactReply(
    "> [example][image]\n\n![Photo][image]\n\n[image]: image.png",
    policy,
    signal,
    upload
  );
  assert.deepEqual(imageOnly.files, []);
  const mixed = await prepareArtifactReply(
    "![Photo][image]\n\n[Download][image] [Alias](alias.png)\n\n[image]: image.png",
    policy,
    signal,
    upload
  );
  assert.equal(uploads, 2);
  assert.deepEqual(mixed.files, [
    {
      url: "https://cdn.example.com/image.png",
      name: "image.png",
      size: 5,
      extension: "png"
    }
  ]);
  assert.match(mixed.text, /!\[Photo\]\[image\]/);
  assert.match(mixed.text, /\[Download\]\[image\]/);
  assert.match(mixed.text, /\[image\]: https:\/\/cdn.example.com\/image.png/);
});

for (const command of ["/stop", "/reset", "shutdown"]) {
  test(`${command} cancels in-flight final delivery without rerunning generation`, async (t) => {
    let receive,
      entered = false,
      aborted = false,
      calls = 0;
    const replies = [];
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(config(process.cwd()), {
      kernel: {
        async *invoke() {
          calls++;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "[Game](game.html)" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: false };
        }
      }
    });
    await runtime.start();
    const message = {
      messageId: "m",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "create a game",
      async buildContext() {
        return { schema, items: [] };
      },
      async reply(text) {
        replies.push(text);
      },
      async replyFinal(_text, _key, options) {
        entered = true;
        assert.equal(options.artifacts.workspace, process.cwd());
        await new Promise((resolve) =>
          options.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          )
        );
        assert.equal(options.obsolete(), true);
        options.signal.throwIfAborted();
      }
    };
    receive(message);
    await waitFor(() => entered);
    if (command === "shutdown") await assert.rejects(runtime.close(), /DISPOSE_FAILED/);
    else {
      receive({ ...message, messageId: "control", text: command });
      await waitFor(() => aborted && runtime.status.sessions.length === 0);
      await runtime.close();
    }
    assert.equal(aborted, true);
    assert.equal(calls, 1);
    assert.equal(
      replies.some((reply) => reply.includes("[Game]")),
      false
    );
  });
}

for (const scenario of ["/stop", "/reset", "shutdown", "finish-error-stop", "complete"]) {
  test(`presentation cleanup retains final-delivery cancellation ownership: ${scenario}`, async (t) => {
    const { workspace } = await fixture(t);
    await writeFile(join(workspace, "game.html"), "game");
    let receive,
      release,
      finishing = false,
      calls = 0,
      cancellations = 0,
      uploads = 0,
      cards = 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const replies = [],
      finals = [],
      snapshots = [],
      terminals = [];
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(config(workspace), {
      kernel: {
        async *invoke() {
          calls++;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "[Game](game.html)" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          cancellations++;
          return { accepted: false };
        }
      },
      log(_level, event, data) {
        if (event === "agent_run.finished") terminals.push(data.status);
      }
    });
    t.after(async () => {
      release();
      await runtime.close().catch(() => {});
    });
    await runtime.start();
    const message = {
      messageId: "create",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "create a game",
      async buildContext() {
        return { schema, items: [] };
      },
      async reply(text) {
        replies.push(text);
      },
      beginPresentation() {
        return {
          update(snapshot) {
            snapshots.push(snapshot);
          },
          async finish() {
            finishing = true;
            await gate;
            if (scenario === "finish-error-stop") throw new Error("synthetic finish failure");
          }
        };
      },
      async replyFinal(text, _key, options) {
        options.signal.throwIfAborted();
        assert.equal(options.obsolete(), false);
        const prepared = await prepareArtifactReply(
          text,
          options.artifacts,
          options.signal,
          async (_bytes, name) => {
            uploads++;
            return `https://cdn.example.com/${name}`;
          }
        );
        cards += prepared.files.length;
        finals.push(prepared.text);
      }
    };
    receive(message);
    await waitFor(() => finishing);
    assert.deepEqual(terminals, ["completed"]);
    assert.equal(snapshots.at(-1).terminal, "completed");
    assert.deepEqual(runtime.status.tasks, []);
    assert.equal(runtime.status.sessions[0].active, false);
    assert.equal(uploads, 0);
    if (scenario === "shutdown") await assert.rejects(runtime.close(), /IM_DISPOSE_FAILED/);
    else if (scenario !== "complete") {
      receive({
        ...message,
        messageId: "control",
        text: scenario === "finish-error-stop" ? "/stop" : scenario
      });
      await waitFor(() => replies.length > 0);
    }
    release();
    await waitFor(() => runtime.status.sessions.length === 0);
    assert.equal(calls, 1);
    assert.equal(cancellations, 0, "a confirmed completed execution must not be cancelled again");
    assert.deepEqual(terminals, ["completed"]);
    assert.equal(uploads, scenario === "complete" ? 1 : 0);
    assert.equal(cards, scenario === "complete" ? 1 : 0);
    assert.equal(finals.length, scenario === "complete" ? 1 : 0);
    if (scenario === "complete")
      assert.equal(finals[0], "[Game](https://cdn.example.com/game.html)");
    if (scenario !== "shutdown") {
      if (scenario === "/stop" || scenario === "finish-error-stop")
        assert.ok(replies.includes("已请求停止本轮执行。"));
      receive({ ...message, messageId: "after", text: "/stop" });
      await waitFor(() => replies.at(-1) === "当前没有可停止的执行。");
      await runtime.close();
    }
  });
}
