import assert from "node:assert/strict";
import { once, getEventListeners } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import {
  OpenClawGatewayClient,
  OpenClawGatewayRpcError,
  createOpenClawDeviceIdentity
} from "../packages/octo-runtime-adapter-openclaw/dist/gateway.js";

async function fixture(t, respond) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    return new Promise((resolve) => server.close(resolve));
  });
  server.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "fixture", ts: Date.now() }
      })
    );
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      const reply = (payload, error) =>
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: !error,
            ...(error ? { error } : { payload })
          })
        );
      respond(frame, reply);
    });
  });
  const client = new OpenClawGatewayClient({
    url: `ws://127.0.0.1:${server.address().port}`,
    token: "fixture",
    device: createOpenClawDeviceIdentity(),
    connectTimeoutMs: 500
  });
  t.after(() => client.close());
  return client;
}

test(
  "Gateway client retains accepted, queued and in_flight until an actual final response",
  { timeout: 2000 },
  async (t) => {
    let final;
    const client = await fixture(t, (frame, reply) => {
      if (frame.method === "connect")
        return reply({ type: "hello-ok", protocol: 4, server: { version: "2026.7.1" } });
      for (const status of ["accepted", "queued", "in_flight"])
        reply({ status, runId: "native-run" });
      final = () => reply({ status: "ok", result: { payloads: [{ text: "done" }] } });
    });
    assert.equal((await client.connect()).server.version, "2026.7.1");
    const accepted = [];
    let done = false;
    const response = client
      .request(
        "agent",
        {},
        { expectFinal: true, onAccepted: (value) => accepted.push(value.status) }
      )
      .then((value) => {
        done = true;
        return value;
      });
    while (accepted.length < 3) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false);
    final();
    assert.equal((await response).status, "ok");
    assert.deepEqual(accepted, ["accepted", "queued", "in_flight"]);
  }
);

test(
  "Gateway RPC errors retain method and native code without retaining arbitrary details",
  { timeout: 2000 },
  async (t) => {
    const client = await fixture(t, (frame, reply) =>
      frame.method === "connect"
        ? reply({ type: "hello-ok", protocol: 4 })
        : reply(undefined, {
            code: "INVALID_REQUEST",
            message: "invalid sessions.create params",
            details: { secret: "do-not-retain" }
          })
    );
    await client.connect();
    await assert.rejects(client.request("sessions.create", {}), (error) => {
      assert.ok(error instanceof OpenClawGatewayRpcError);
      assert.equal(error.method, "sessions.create");
      assert.equal(error.code, "INVALID_REQUEST");
      assert.doesNotMatch(JSON.stringify(error), /do-not-retain/);
      return true;
    });
  }
);

test(
  "invalid hello rejects promptly instead of leaving an unhandled callback rejection",
  { timeout: 2000 },
  async (t) => {
    const client = await fixture(t, (_frame, reply) => reply({ type: "invalid" }));
    await assert.rejects(client.connect(), /invalid hello response/);
  }
);

test(
  "already aborted RPCs settle without sending, and timeout releases the signal listener",
  { timeout: 2000 },
  async (t) => {
    const methods = [];
    const client = await fixture(t, (frame, reply) => {
      methods.push(frame.method);
      if (frame.method === "connect") reply({ type: "hello-ok", protocol: 4 });
    });
    await client.connect();
    await assert.rejects(client.request("agent", {}, { signal: AbortSignal.abort() }), /aborted/);
    assert.deepEqual(methods, ["connect"]);
    const controller = new AbortController();
    await assert.rejects(
      client.request("agent.wait", {}, { timeoutMs: 10, signal: controller.signal }),
      /timed out/
    );
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
);
