// 显式本地运行；不接入默认测试入口或 CI。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RuntimeLogging } from "../../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { CardSession } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/card-session.js";
import { OctoConnector } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { OctoApiError } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/errors.js";
import { ImDeliveryDispatcher } from "../../../packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js";
import { ImRunProjector } from "../../../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";

const event = (type, payload = {}) => ({ protocolVersion: 2, type, payload });
const template = { ref: { id: "ai.reasoning-process", version: "0.4.1" }, maxPayloadBytes: 16384 };

async function fixture(t, reject) {
  const requests = [],
    diagnostics = [];
  const abort = new AbortController();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ path: req.url, body });
    const response = reject(body, requests.length);
    res.writeHead(response ? 400 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response ?? { message_id: "same-card" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    abort.abort();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const connector = new OctoConnector(
    { bot_id: "fixture", api_url: `http://127.0.0.1:${server.address().port}`, adapter: {} },
    randomUUID(),
    abort.signal,
    async () => {}
  );
  t.mock.method(connector, "reasoningTemplate", async () => template);
  const card = new CardSession(
    connector,
    new ImDeliveryDispatcher(abort.signal),
    { channelId: "group____topic", channelType: 2 },
    "run",
    () => {},
    (code, data) => diagnostics.push({ code, ...data })
  );
  t.after(() => card.release());
  return { requests, diagnostics, card, abort };
}

for (const terminal of ["completed", "cancelled", "failed", "unknown"]) {
  test(`400 degrades the same card and preserves ${terminal} without poisoning finish`, async (t) => {
    const f = await fixture(t, (_body, attempt) =>
      attempt === 2 ? { error: "rich frame rejected" } : undefined
    );
    const p = new ImRunProjector("run");
    f.card.update(p.snapshot());
    await f.card.finish();
    if (terminal !== "unknown") p.accept(event(`run.${terminal}`));
    f.card.update({ ...p.snapshot(), ...(terminal === "unknown" ? { resultUnknown: true } : {}) });
    await f.card.finish();
    await f.card.finish();
    assert.equal(f.requests.length, 3);
    const edits = f.requests.slice(1).map(({ body }) => body);
    assert.deepEqual(
      edits.map((body) => body.card_seq),
      [2, 3]
    );
    assert.ok(
      edits.every((body) => body.message_id === "same-card" && body.transient === undefined)
    );
    assert.equal(
      edits[1].state,
      terminal === "completed" ? "completed" : terminal === "failed" ? "error" : "stopped"
    );
    assert.equal(edits[1].data.progressText, undefined);
    assert.equal(edits[1].data.traceCollapsed, true);
    assert.deepEqual(
      f.diagnostics.map(({ code }) => code),
      ["IM_CARD_EDIT_400", "IM_CARD_TERMINAL_DEGRADED"]
    );
    assert.equal(f.diagnostics[0].path, "/v1/bot/message/edit");
    assert.equal(f.diagnostics[0].http_status, 400);
    if (process.env.OCTO_CARD_RENDER_PROBE) {
      const result = spawnSync(process.env.OCTO_CARD_RENDER_PROBE, [], {
        input:
          JSON.stringify({ version: "0.4.1", state: edits[1].state, data: edits[1].data }) + "\n",
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    }
  });
}

test("400 on a terminal create is classified SEND and retries only after explicit rejection", async (t) => {
  const f = await fixture(t, (_body, attempt) =>
    attempt === 1 ? { error: "rejected" } : undefined
  );
  const p = new ImRunProjector("run");
  p.accept(event("run.completed"));
  f.card.update(p.snapshot());
  await f.card.finish();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].body.client_msg_no, f.requests[1].body.client_msg_no);
  assert.equal(f.card.messageId, "same-card");
  assert.equal(f.diagnostics[0].code, "IM_CARD_SEND_400");
  assert.equal(f.diagnostics[0].path, "/v1/bot/sendMessage");
});

test("a progress 400 does not block a later successful terminal", async (t) => {
  const f = await fixture(t, (_body, attempt) =>
    attempt === 1 ? { error: "rejected" } : undefined
  );
  const p = new ImRunProjector("run");
  f.card.update(p.snapshot());
  await f.card.finish();
  assert.equal(f.requests.length, 1);
  p.accept(event("run.completed"));
  f.card.update(p.snapshot());
  await f.card.finish();
  assert.equal(f.requests.length, 2);
  assert.deepEqual(
    f.diagnostics.map(({ code }) => code),
    ["IM_CARD_SEND_400"]
  );
});

test("rejected compact terminal remains a failure across repeated finish", async (t) => {
  const f = await fixture(t, (_body, attempt) =>
    attempt > 1 ? { error: "still rejected" } : undefined
  );
  const p = new ImRunProjector("run");
  f.card.update(p.snapshot());
  await f.card.finish();
  p.accept(event("run.completed"));
  f.card.update(p.snapshot());
  await assert.rejects(f.card.finish(), /IM_CARD_FINALIZATION_FAILED/);
  await assert.rejects(f.card.finish(), /IM_CARD_FINALIZATION_FAILED/);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(
    f.diagnostics.map(({ code }) => code),
    ["IM_CARD_EDIT_400", "IM_CARD_EDIT_400"]
  );
});

for (const status of [401, 403, 409, undefined]) {
  test(`HTTP ${status ?? "unknown delivery"} is not silently converted into successful finish`, async () => {
    let calls = 0;
    const card = new CardSession(
      {
        config: { bot_id: "fixture", api_url: "https://fixture.invalid", adapter: {} },
        reasoningTemplate: async () => template,
        card: async () => {
          calls++;
          if (status)
            throw new OctoApiError({
              status,
              path: "/v1/bot/sendMessage",
              body: "rejected",
              retryAfterMs: 0
            });
          throw new Error("no response");
        }
      },
      new ImDeliveryDispatcher(new AbortController().signal),
      { channelId: "peer", channelType: 1 },
      "run",
      () => {},
      () => {}
    );
    const p = new ImRunProjector("run");
    p.accept(event("run.completed"));
    card.update(p.snapshot());
    await assert.rejects(card.finish(), /IM_CARD_FINALIZATION_FAILED/);
    assert.equal(
      calls,
      status ? 1 : 3,
      "no additional compact delivery after unknown or unrelated HTTP failures"
    );
    card.release();
  });
}

test("cancellation after rejected rich frame prevents compact dispatch", async (t) => {
  const f = await fixture(t, (_body, attempt) =>
    attempt === 2 ? { error: "rejected" } : undefined
  );
  const p = new ImRunProjector("run");
  f.card.update(p.snapshot());
  await f.card.finish();
  const deliver = f.card.delivery.deliver;
  t.mock.method(f.card.delivery, "deliver", async function (...args) {
    const receipt = await deliver.apply(this, args);
    if (receipt.code === "IM_CARD_EDIT_400") f.abort.abort();
    return receipt;
  });
  p.accept(event("run.completed"));
  f.card.update(p.snapshot());
  await assert.rejects(f.card.finish(), /IM_CARD_FINALIZATION_FAILED/);
  assert.equal(f.requests.length, 2);
  assert.equal(f.diagnostics.at(-1).code, "IM_DELIVERY_CANCELLED");
});

test("dispatch diagnostics survive the actual log whitelist with redaction and bounded Unicode", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-249-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logging = new RuntimeLogging({ directory });
  t.after(() => logging.close());
  const log = logging.extra("channel-gateway");
  const secret = randomUUID();
  const body = JSON.stringify({
    error: { code: "card_invalid", token: secret, message: "中文".repeat(300) }
  });
  const diagnostics = [];
  const dispatcher = new ImDeliveryDispatcher(new AbortController().signal);
  const receipt = await dispatcher.deliver(
    "card",
    async () => {
      throw new OctoApiError({
        status: 400,
        path: "/v1/bot/message/edit?token=" + secret,
        body,
        retryAfterMs: 0
      });
    },
    {
      cardOperation: "edit",
      onDiagnostic(code, data) {
        diagnostics.push(data);
        log("warn", "channel.diagnostic", { code, ...data, run_id: "run" });
      }
    }
  );
  assert.equal(receipt.code, "IM_CARD_EDIT_400");
  assert.ok(Array.from(diagnostics[0].response_body).length <= 200);
  assert.ok(!JSON.stringify(diagnostics).includes(secret));
  for (const [name, eventName] of [
    ["other", "channel.diagnostic"],
    ["channel-gateway", "other.event"]
  ])
    logging.extra(name)("warn", eventName, { code: receipt.code, ...diagnostics[0] });
  await logging.close();
  const logs = [];
  for (const name of await readdir(join(directory, "extras"))) {
    const text = await readFile(join(directory, "extras", name), "utf8");
    assert.ok(!text.includes(secret));
    logs.push(
      ...text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    );
  }
  const row = logs.find(
    (row) => row.extra_type === "channel-gateway" && row.event === "channel.diagnostic"
  );
  assert.equal(row.data.path, "/v1/bot/message/edit");
  assert.equal(row.data.http_status, 400);
  assert.match(row.data.response_body, /card_invalid/);
  assert.ok(Array.from(row.data.response_body).length <= 200);
  assert.ok(
    logs
      .filter((record) => record !== row)
      .every((record) => record.data.response_body === undefined)
  );
});

test("structured and truncated credential fields stay private in dispatch and disk logs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-249-credentials-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logging = new RuntimeLogging({ directory });
  t.after(() => logging.close());
  const log = logging.extra("channel-gateway");
  const secrets = [];
  let count = 0;
  for (const key of [
    "authorization",
    "cookie",
    "credential",
    "private_key",
    "proxy-authorization"
  ]) {
    for (const format of [
      "json",
      "truncated-json",
      "text",
      "json-message",
      "json-message-object"
    ]) {
      const secret = randomUUID();
      secrets.push(secret);
      const text =
        format === "text"
          ? `card_invalid ${key}: ${secret} more private data`
          : JSON.stringify({
              error: {
                code: "card_invalid",
                ...(format === "json-message-object"
                  ? { message: JSON.stringify({ [key]: secret }) }
                  : format === "json-message"
                    ? { message: `${key}: ${secret} more private data` }
                    : {
                        details: { [key]: secret },
                        message: "中文".repeat(format === "json" ? 1 : 400)
                      })
              }
            });
      const error = OctoApiError.from({ status: 400 }, "/v1/bot/message/edit", text);
      let diagnostic;
      const receipt = await new ImDeliveryDispatcher(new AbortController().signal).deliver(
        `credential-${count++}`,
        async () => {
          throw error;
        },
        {
          cardOperation: "edit",
          onDiagnostic(code, data) {
            diagnostic = data;
            log("warn", "channel.diagnostic", { code, ...data });
          }
        }
      );
      assert.equal(receipt.code, "IM_CARD_EDIT_400");
      assert.ok(!JSON.stringify(diagnostic).includes(secret));
      assert.match(diagnostic.response_body, /card_invalid/);
      // The log boundary must independently sanitize a caller's unsanitized body too.
      log("warn", "channel.diagnostic", { code: receipt.code, response_body: error.body });
    }
  }
  await logging.close();
  const rows = [];
  for (const name of await readdir(join(directory, "extras"))) {
    const text = await readFile(join(directory, "extras", name), "utf8");
    for (const secret of secrets) assert.ok(!text.includes(secret));
    rows.push(...text.trim().split("\n").map(JSON.parse));
  }
  assert.equal(rows.length, count * 2);
  assert.ok(rows.every((row) => Array.from(row.data.response_body).length <= 200));
  assert.ok(rows.every((row) => /card_invalid/.test(row.data.response_body)));
});
