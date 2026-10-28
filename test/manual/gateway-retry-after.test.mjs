// 手动专项：先 pnpm typecheck，再 node --test test/manual/gateway-retry-after.test.mjs。
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  DEFAULT_RETRY_AFTER_MS,
  OctoApiError
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/errors.js";
import {
  MAX_429_RETRIES,
  MAX_429_BACKOFF_WAIT_MS,
  MAX_RETRY_AFTER_MS,
  postJson
} from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js";
import { sendMessage } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/api/messages.js";
import { httpConnectionFailure } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/connection-error.js";

const fixedNow = Date.parse("2026-10-28T08:00:00.250Z");
const hintBody = (seconds) => JSON.stringify({ error: { details: { retry_after: seconds } } });
const response = (hint) =>
  new Response("{}", {
    status: 429,
    headers: hint === undefined ? {} : { "Retry-After": hint }
  });
const apiError = (hint, body = "") => OctoApiError.from(response(hint), "/fixture", body);

test("REST and connection errors honor future HTTP-date hints", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  const date = new Date(fixedNow + 6000).toUTCString();
  const remaining = Date.parse(date) - fixedNow;
  assert.equal(apiError(date, hintBody(1)).retryAfterMs, remaining);
  for (const phase of ["AUTH", "REGISTER"]) {
    const failure = await httpConnectionFailure(response(date), phase);
    assert.equal(failure.retryAfterMs, remaining);
    assert.equal(failure.retryable, true);
    assert.equal(failure.message, `IM_${phase}_HTTP_429`);
  }
});

test("numeric hints and zero/invalid fallback policies remain bounded", async (t) => {
  t.mock.method(Date, "now", () => fixedNow);
  for (const [hint, expected] of [
    ["6", 6000],
    ["1.25", 1250],
    [" 2 ", 2000],
    ["10001", 10_001_000],
    ["0", 0],
    ["0.0004", 0],
    [new Date(fixedNow - 60_000).toUTCString(), 0],
    [new Date(Math.floor(fixedNow / 1000) * 1000).toUTCString(), 0],
    [undefined, 0],
    ["", 0],
    [" ", 0],
    ["not-a-date", 0],
    ["-1", 0],
    ["NaN", 0],
    ["Infinity", 0],
    ["1e309", 0],
    ["1e308", Infinity]
  ]) {
    await t.test(String(hint), async () => {
      assert.equal(apiError(hint).retryAfterMs, expected || DEFAULT_RETRY_AFTER_MS);
      assert.equal(apiError(hint, hintBody(3)).retryAfterMs, expected || 3000);
      const failure = await httpConnectionFailure(response(hint), "AUTH");
      assert.equal(failure.retryAfterMs, Number.isFinite(expected) ? expected : 0);
    });
  }
  for (const invalid of [0, -1, "3", null]) {
    assert.equal(apiError(undefined, hintBody(invalid)).retryAfterMs, DEFAULT_RETRY_AFTER_MS);
  }
  assert.equal(apiError(undefined, "not-json").retryAfterMs, DEFAULT_RETRY_AFTER_MS);
  assert.equal(apiError(undefined, hintBody(1.25)).retryAfterMs, 1250);
  assert.equal(apiError(undefined, hintBody(1e308)).retryAfterMs, Infinity);
});

async function httpFixture(t, respond) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ at: Date.now(), path: req.url, body: JSON.parse(body) });
      respond(res, requests.length);
    });
  });
  t.after(async () => {
    const closed = new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const botToken = randomUUID();
  return {
    requests,
    send: (signal) =>
      sendMessage({
        apiUrl,
        botToken,
        channelId: "retry-fixture",
        channelType: 2,
        content: "retry fixture",
        signal
      }),
    post: (signal, opts) => postJson(apiUrl, botToken, "/fixture", {}, signal, opts)
  };
}

function limited(res, hint) {
  res.writeHead(429, { "Retry-After": hint });
  res.end("{}");
}

function success(res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message_id: "fixture-message" }));
}

test(
  "real HTTP message retry never precedes the advertised date",
  { timeout: 15_000 },
  async (t) => {
    let earliest;
    const f = await httpFixture(t, (res, attempt) => {
      if (attempt === 1) {
        earliest = Math.ceil(Date.now() / 1000) * 1000 + 2000;
        limited(res, new Date(earliest).toUTCString());
      } else success(res);
    });
    const result = await f.send();
    assert.equal(result.message_id, "fixture-message");
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests[1].at >= earliest, `retried ${earliest - f.requests[1].at} ms early`);
    assert.equal(f.requests[0].path, "/v1/bot/sendMessage");
    assert.equal(f.requests[1].body.client_msg_no, f.requests[0].body.client_msg_no);
  }
);

test("real HTTP numeric seconds retain their minimum wait", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res, attempt) =>
    attempt === 1 ? limited(res, "0.1") : success(res)
  );
  await f.send();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].at - f.requests[0].at >= 100);
});

test("real HTTP over-budget date returns 429 without retrying", async (t) => {
  const f = await httpFixture(t, (res) =>
    limited(res, new Date(Date.now() + MAX_RETRY_AFTER_MS + 5000).toUTCString())
  );
  await assert.rejects(f.send(), (error) => {
    assert.ok(error instanceof OctoApiError);
    assert.equal(error.status, 429);
    assert.ok(error.retryAfterMs > MAX_RETRY_AFTER_MS);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("real HTTP persistent 429 stops after two retries", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "0.01"));
  await assert.rejects(f.send(), OctoApiError);
  assert.equal(f.requests.length, MAX_429_RETRIES + 1);
  assert.equal(f.requests.length, 3);
});

test("real HTTP numeric conversion overflow remains over budget", { timeout: 5000 }, async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "1" + "0".repeat(308)));
  await assert.rejects(f.send(), (error) => {
    assert.ok(error instanceof OctoApiError);
    assert.equal(error.retryAfterMs, Infinity);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("real HTTP retry opt-out sends only the original request", async (t) => {
  const f = await httpFixture(t, (res) => limited(res, "0.01"));
  await assert.rejects(f.post(undefined, { retryOn429: false }), OctoApiError);
  assert.equal(f.requests.length, 1);
});

test("abort during a date backoff prevents another real HTTP request", async (t) => {
  const controller = new AbortController();
  t.mock.method(console, "warn", () => queueMicrotask(() => controller.abort()));
  const f = await httpFixture(t, (res) => limited(res, new Date(Date.now() + 6000).toUTCString()));
  await assert.rejects(f.send(controller.signal), (error) => {
    assert.ok(error.cause instanceof OctoApiError);
    assert.match(error.message, /aborted while backing off/);
    return true;
  });
  assert.equal(f.requests.length, 1);
});

test("cumulative backoff budget rejects the next wait without shortening it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: fixedNow });
  t.mock.method(Math, "random", () => 0);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response(new Date(Date.now() + 9000).toUTCString());
  });
  const result = assert.rejects(
    postJson("http://127.0.0.1", randomUUID(), "/fixture", {}),
    (error) => {
      assert.ok(error instanceof OctoApiError);
      assert.equal(error.retryAfterMs, 9000);
      return true;
    }
  );
  await nextTurn();
  assert.equal(calls, 1);
  const firstWait = 8750;
  assert.ok(firstWait + 9000 > MAX_429_BACKOFF_WAIT_MS);
  t.mock.timers.tick(firstWait - 1);
  await nextTurn();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await result;
  assert.equal(calls, 2);
});
