import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setImmediate as settle } from "node:timers/promises";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { artifactImage } from "../../../test-support/channel-artifact-samples.mjs";

const source = pathToFileURL(`${process.env.OCTO_255_SOURCE_ROOT ?? process.cwd()}/`);
const gateway = (name) =>
  import(new URL(`packages/octo-runtime-extra-channel-gateway/dist/${name}.js`, source));
const { GatewayTransport } = await gateway("transport/channel");
const { WukongConnection } = await gateway("transport/wukong");
const { ImDeliveryIdentity } = await gateway("delivery/identity");
const { ImDeliveryDispatcher } = await gateway("delivery/dispatcher");
const { ImRuntime } = await gateway("index");
const { CardSession } = await gateway("transport/card-session");
const { ImRunProjector } = await gateway("presentation/run-projector");
const { OctoApiError } = await gateway("transport/api/errors");
const { RuntimeLogging } = await import(
  new URL("packages/octo-runtime-adapter-sdk/dist/index.js", source)
);
const { prepareInvokeInput } = await import(
  new URL("packages/octo-runtime-executor-core/dist/index.js", source)
);

const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await settle();
  }
  assert.fail("operation must settle without waiting for WS recovery");
};

async function waitForDelivery(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "bounded delivery must finish");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function gatewayLogs(home) {
  return execFileSync(
    process.execPath,
    [
      new URL("apps/cli/dist/index.js", source).pathname,
      "--home",
      home,
      "channel-gateway",
      "logs",
      "--json"
    ],
    { encoding: "utf8", timeout: 5000 }
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fixture(t, receive, overrides = {}) {
  const owner = new AbortController();
  const token = `bf_${randomUUID()}`;
  const requests = [],
    sockets = [],
    transports = [],
    positions = [],
    inbound = [];
  let current, hook;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    options.signal.throwIfAborted();
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, options, body });
    const intercepted = await hook?.(url, options, body);
    if (intercepted) return intercepted;
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: "bot", space_id: "space" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: "bot",
        im_token: randomUUID(),
        ws_url: "wss://fixture.invalid/ws"
      });
    if (url.endsWith("/bot/users/batch")) return Response.json({ users: [] });
    if (url.endsWith("/bot/sendMessage"))
      return Response.json({
        message_id: `sent-${requests.length}`,
        message_seq: 100 + requests.length
      });
    if (url.includes("/user/info")) return Response.json({ uid: "owner", name: "Owner", robot: 0 });
    throw new Error("unexpected fixture request");
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    sockets.push(this);
  });
  t.mock.getter(WukongConnection.prototype, "connected", () => true);
  t.mock.method(WukongConnection.prototype, "close", async () => {});
  const config = {
    bot_id: "bot",
    api_url: "https://fixture.invalid/api",
    cards: false,
    typing: false,
    adapter: { adapter_type: "codex", workdir: process.cwd() },
    ...overrides
  };
  const lifetime = {
    signal: owner.signal,
    dispatcher: new ImDeliveryDispatcher(owner.signal),
    identity: new ImDeliveryIdentity(),
    token: () => token
  };
  const replace = async () => {
    const connection = new AbortController();
    current = new GatewayTransport(
      config,
      async () => token,
      {
        onMessage(message) {
          inbound.push(message);
          receive?.(message);
        },
        onDisconnect() {},
        onPosition: (value) => positions.push(value),
        onTaskPosition: (value) => positions.push(value)
      },
      lifetime
    );
    transports.push({ transport: current, connection });
    await current.start(connection.signal);
  };
  const retire = async () => {
    const entry = transports.at(-1);
    entry.connection.abort();
    await entry.transport.close();
    current = undefined;
  };
  const send = (id = "request") =>
    sockets.at(-1).onMessage({
      messageId: id,
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 1, content: id }
    });
  t.after(async () => {
    owner.abort();
    await Promise.all(transports.map(({ transport }) => transport.close()));
  });
  await replace();
  send();
  return {
    owner,
    config,
    token,
    requests,
    sockets,
    inbound,
    positions,
    replace,
    retire,
    send,
    hook(value) {
      hook = value;
    },
    messages: () => requests.filter(({ url }) => url.endsWith("/bot/sendMessage"))
  };
}

test("accepted input preparation survives retirement of its receiving WS", async (t) => {
  const f = await fixture(t);
  await f.retire();
  const environment = f.inbound[0].executionEnvironment();
  assert.ok(environment.executionEnvOverrides.env_variables.length > 0);
  const contexts = await f.inbound[0].buildContext(f.owner.signal, { initialSession: false });
  assert.equal(
    contexts.items.find((item) => item.name === "message-trigger").payload.sender.uid,
    "owner"
  );
});

test(
  "final and ordinary replies complete before WS recovery, including repeated handovers",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t);
    const original = f.inbound[0];
    for (let index = 0; index < 3; index++) {
      await f.retire();
      await original.replyFinal(`done-${index}`, `final:${index}`);
      await original.reply(`control-${index}`, `control:${index}`);
      assert.equal(f.messages().length, 2 * (index + 1));
      if (index < 2) await f.replace();
    }
  }
);

test("concurrent final calls share one HTTP request and its successful receipt", async (t) => {
  const f = await fixture(t);
  await Promise.all([
    f.inbound[0].replyFinal("done", "same"),
    f.inbound[0].replyFinal("done", "same")
  ]);
  await f.inbound[0].replyFinal("done", "same");
  assert.equal(f.messages().length, 1);
});

for (const [name, response] of [
  ["server failure", () => Response.json({}, { status: 503 })],
  ["missing receipt", () => Response.json({})],
  ["invalid receipt", () => Response.json({ message_id: {} })]
]) {
  test(`${name} is reported per REST attempt without selecting a recovered WS`, async (t) => {
    const f = await fixture(t);
    f.hook((url) => (url.endsWith("/bot/sendMessage") ? response() : undefined));
    await assert.rejects(
      f.inbound[0].replyFinal("done", "uncertain"),
      (error) => error.state === "unknown"
    );
    await f.retire();
    await f.replace();
    await assert.rejects(
      f.inbound[0].replyFinal("done", "uncertain"),
      (error) => error.state === "unknown"
    );
    assert.equal(f.messages().length, 2);
  });
}

test("explicit HTTP rejection never waits for WS and can later use the same effect", async (t) => {
  const f = await fixture(t);
  await f.retire();
  f.hook((url) =>
    url.endsWith("/bot/sendMessage") ? Response.json({}, { status: 403 }) : undefined
  );
  await assert.rejects(
    f.inbound[0].replyFinal("done", "rejected"),
    (error) => error.status === 403
  );
  f.hook(undefined);
  await f.inbound[0].replyFinal("done", "rejected");
  assert.equal(f.messages().length, 2);
});

test("accepted image download survives original WS closure before and during HTTP", async (t) => {
  let finish, requested;
  const server = createServer((_req, response) => {
    requested = true;
    finish = () => {
      response.setHeader("Content-Type", "image/png");
      response.end(artifactImage());
    };
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const f = await fixture(t, undefined, {
    api_url: `http://127.0.0.1:${server.address().port}/api`
  });
  const acceptImage = (id) => {
    f.sockets.at(-1).onMessage({
      messageId: id,
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 2, url: "/image.png" }
    });
    return f.inbound.at(-1);
  };
  const first = acceptImage("before");
  await f.retire();
  const before = first.buildInputs(f.owner.signal);
  await until(() => requested);
  finish();
  assert.equal((await before)[0].type, "image");
  await f.replace();
  requested = false;
  const during = acceptImage("during").buildInputs(f.owner.signal);
  await until(() => requested);
  await f.retire();
  finish();
  assert.equal((await during)[0].type, "image");
  f.owner.abort();
  await assert.rejects(async () => first.buildInputs(f.owner.signal));
});

test("unknown HTTP attempt leaves the same effect available to the current final retry", async (t) => {
  const f = await fixture(t);
  f.hook((url) => {
    if (url.endsWith("/bot/sendMessage"))
      throw new TypeError("response lost after server acceptance");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      f.inbound[0].replyFinal("done", "unknown"),
      (error) => error.state === "unknown"
    );
    if (!attempt) {
      await f.retire();
      await f.replace();
    }
  }
  assert.equal(f.messages().length, 2);
});

test("REST positions remain observable while WS is offline and retain the original turn", async (t) => {
  const f = await fixture(t);
  // Group callback is needed for history observations; no context fetch is performed here.
  f.sockets[0].onMessage({
    messageId: "group-request",
    fromUid: "owner",
    channelId: "group",
    channelType: 2,
    payload: { type: 1, content: "work", mention: { uids: ["bot"] } }
  });
  const original = f.inbound.at(-1);
  const turn = {
    sessionId: "session",
    generation: 1,
    processEpoch: "epoch",
    providerSessionId: "provider"
  };
  original.bindHistoryTurn(turn);
  await f.retire();
  await original.replyFinal("done", "position");
  assert.deepEqual(f.positions[0].turn, turn);
  assert.ok(f.positions[0].messageSeq > 0);
  assert.ok(f.positions[0].outputFingerprint);
});

test(
  "real Runtime drains accepted FIFO tasks and deduplicates replay after its WS closes",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const calls = [];
    const runtime = new ImRuntime(f.config, {
      credentials: async () => f.token,
      kernel: {
        async *invoke(input) {
          calls.push(prepareInvokeInput(input).request.prompt);
          if (calls.length === 1) await gate;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "done" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        }
      }
    });
    t.after(async () => {
      release();
      await runtime.close();
    });
    await runtime.start();
    const incoming = (id) =>
      f.sockets.at(-1).onMessage({
        messageId: id,
        fromUid: "owner",
        channelId: "owner",
        channelType: 1,
        payload: { type: 1, content: id }
      });
    incoming("task-0");
    await until(() => calls.length === 1);
    for (let i = 1; i <= 4; i++) incoming(`task-${i}`);
    incoming("task-2");
    assert.equal(runtime.status.queuedTasks, 4);
    f.hook((url) =>
      url.endsWith("/bot/register") ? Response.json({}, { status: 503 }) : undefined
    );
    f.sockets.at(-1).onDisconnect(new Error("IM_DISCONNECTED"));
    await settle();
    release();
    await until(() => runtime.status.workingTasks === 0);
    assert.deepEqual(calls, ["task-0", "task-1", "task-2", "task-3", "task-4"]);
    assert.equal(f.messages().length, 5);
    assert.equal(runtime.status.connected, false);
  }
);

for (const outcome of ["network", "503", "missing-receipt", "recovered", "403"]) {
  test(`final ${outcome}: bounded REST retries while WS stays offline, failure visible in CLI logs`, async (t) => {
    const f = await fixture(t);
    const home = await mkdtemp(join(tmpdir(), "octo-255-final-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const logging = new RuntimeLogging({ directory: join(home, "logs") });
    t.after(() => logging.close());
    const events = [];
    const log = logging.extra("channel-gateway");
    let release,
      invokes = 0;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const runtime = new ImRuntime(f.config, {
      credentials: async () => f.token,
      log(level, event, data) {
        events.push({ level, event, data });
        log(level, event, data);
      },
      kernel: {
        async *invoke() {
          invokes++;
          await pending;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "done" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        }
      }
    });
    t.after(async () => {
      release();
      await runtime.close();
    });
    await runtime.start();
    f.send("bounded-final");
    await until(() => invokes === 1);
    let writes = 0;
    f.hook((url) => {
      if (url.endsWith("/bot/register")) return Response.json({}, { status: 503 });
      if (!url.endsWith("/bot/sendMessage")) return;
      writes++;
      if (outcome === "recovered" && writes === 3) return Response.json({ message_id: "ok" });
      if (outcome === "network" || outcome === "recovered") throw new TypeError("network");
      if (outcome === "missing-receipt") return Response.json({});
      return Response.json({}, { status: Number(outcome) });
    });
    f.sockets.at(-1).onDisconnect(new Error("IM_DISCONNECTED"));
    await settle();
    release();
    await waitForDelivery(() => runtime.status.workingTasks === 0);
    assert.equal(runtime.status.connected, false);
    assert.equal(writes, outcome === "403" ? 1 : outcome === "recovered" ? 3 : 4);
    assert.equal(invokes, 1);
    assert.ok(
      f.messages().every(({ body }) => body.payload.type === 1),
      "no fallback card"
    );
    assert.equal(new Set(f.messages().map(({ body }) => body.client_msg_no)).size, 1);
    assert.equal(
      events.find(({ event }) => event === "agent_run.finished").data.status,
      "completed"
    );
    await runtime.close();
    await logging.close();
    const diagnostic = gatewayLogs(home).find(
      ({ event, data }) => event === "channel.diagnostic" && /IM_(DELIVERY|HTTP)_/.test(data.code)
    );
    if (outcome === "recovered") assert.equal(diagnostic, undefined);
    else {
      assert.equal(diagnostic.level, "warn");
      assert.equal(typeof diagnostic.data.run_id, "string");
      assert.match(diagnostic.data.code, outcome === "403" ? /IM_HTTP_403/ : /IM_DELIVERY_/);
    }
    assert.equal(writes, f.messages().length, "shutdown must not resume delivery");
  });
}

for (const outcome of ["exhausted", "recovered"]) {
  test(`card ${outcome}: progress fails once, finish alone retries three times and logs through CLI`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "octo-255-card-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const logging = new RuntimeLogging({ directory: join(home, "logs") });
    t.after(() => logging.close());
    const log = logging.extra("channel-gateway");
    const writes = [];
    const connector = {
      config: { bot_id: "bot", api_url: "https://fixture.invalid/api" },
      async reasoningTemplate() {
        return { ref: { id: "ai.reasoning-process", version: "0.4.1" }, maxPayloadBytes: 16384 };
      },
      async card(_address, _template, frame, key, id, seq) {
        writes.push({ state: frame.state, key, id, seq });
        if (!id || (frame.state === "completed" && outcome === "recovered" && writes.length === 6))
          return "original-card";
        throw new OctoApiError({
          status: 503,
          path: "/v1/bot/message/edit",
          body: "unavailable",
          retryAfterMs: 0
        });
      }
    };
    const abort = new AbortController();
    t.after(() => abort.abort());
    const card = new CardSession(
      connector,
      new ImDeliveryDispatcher(abort.signal),
      { channelId: "owner", channelType: 1 },
      "card-run",
      () => {},
      (code, data) => log("warn", "channel.diagnostic", { code, ...data, run_id: "card-run" })
    );
    t.after(() => card.release());
    const projector = new ImRunProjector("card-run", true);
    card.update(projector.snapshot());
    await card.finish();
    projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
    card.update(projector.snapshot());
    await card.finish();
    assert.equal(writes.length, 2, "ordinary progress must not retry");
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    card.update(projector.snapshot());
    if (outcome === "exhausted") await assert.rejects(card.finish(), /IM_CARD_FINALIZATION_FAILED/);
    else await card.finish();
    assert.equal(writes.length, 6);
    assert.ok(writes.slice(2).every(({ id, seq }) => id === "original-card" && seq === 3));
    assert.equal(new Set(writes.map(({ key }) => key)).size, 1);
    await logging.close();
    const diagnostic = gatewayLogs(home).find(({ data }) => data.code === "IM_CARD_EDIT_503");
    assert.equal(diagnostic.level, "warn");
    assert.equal(diagnostic.data.run_id, "card-run");
    if (outcome === "exhausted") await assert.rejects(card.finish(), /IM_CARD_FINALIZATION_FAILED/);
    else await card.finish();
    assert.equal(writes.length, 6, "repeated finish must not create another retry budget");
  });
}

for (const statuses of [
  [400, 503, 503, 503, 503],
  [503, 503, 503, 400, 503]
]) {
  test(`terminal card shares four attempts across compact fallback: ${statuses.join(",")}`, async (t) => {
    let writes = 0;
    const abort = new AbortController();
    t.after(() => abort.abort());
    const connector = {
      config: { bot_id: "bot", api_url: "https://fixture.invalid/api" },
      async reasoningTemplate() {
        return { ref: { id: "ai.reasoning-process", version: "0.4.1" }, maxPayloadBytes: 16384 };
      },
      async card() {
        const status = statuses[writes++] ?? 503;
        throw new OctoApiError({
          status,
          path: "/v1/bot/sendMessage",
          body: "rejected",
          retryAfterMs: 0
        });
      }
    };
    const card = new CardSession(
      connector,
      new ImDeliveryDispatcher(abort.signal),
      { channelId: "owner", channelType: 1 },
      "budget-run",
      () => {},
      () => {}
    );
    t.after(() => card.release());
    const projector = new ImRunProjector("budget-run", true);
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    card.update(projector.snapshot());
    await assert.rejects(card.finish(), /IM_CARD_FINALIZATION_FAILED/);
    assert.equal(writes, 4, "compact frame must consume the current finish budget");
  });
}

test("credential delivery failures retain run association in CLI logs", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-255-credentials-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const logging = new RuntimeLogging({ directory: join(home, "logs") });
  t.after(() => logging.close());
  const codes = ["IM_CREDENTIALS_REQUIRED", "IM_BOT_TOKEN_INVALID"];
  for (const code of codes)
    logging.extra("channel-gateway")("warn", "channel.diagnostic", {
      code,
      run_id: "credential-run"
    });
  await logging.close();
  const diagnostics = gatewayLogs(home).filter(({ event }) => event === "channel.diagnostic");
  assert.deepEqual(
    diagnostics.map(({ data }) => data.code),
    codes
  );
  assert.ok(diagnostics.every(({ data }) => data.run_id === "credential-run"));
});
