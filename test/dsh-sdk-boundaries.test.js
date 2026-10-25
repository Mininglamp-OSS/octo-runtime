import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

const adapterRequire = createRequire(
  new URL("../packages/octo-runtime-adapter-dsh/package.json", import.meta.url)
);
const require = createRequire(adapterRequire.resolve("@deepseek-ai/dsh-sdk-client/package.json"));
const { JsonRpcLineTransport } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-sdk-protocol"))
);

function endpoint(t, maxLineBytes, onError) {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new JsonRpcLineTransport(input, output, { maxLineBytes, onError });
  transport.start();
  t.after(() => {
    transport.close();
    input.destroy();
    output.destroy();
  });
  return { input, output, transport };
}

test("official Protocol accepts an exact byte budget with split UTF-8, CRLF and several lines per chunk", (t) => {
  const frame =
    JSON.stringify({ jsonrpc: "2.0", method: "fixture", params: { text: "界" } }) + "\r";
  const bytes = Buffer.from(frame + "\n");
  const { input, transport } = endpoint(t, Buffer.byteLength(frame));
  const received = [];
  transport.onNotification((method, params) => received.push({ method, params }));
  const split = bytes.indexOf(Buffer.from("界")) + 1;
  input.write(bytes.subarray(0, split));
  input.write(Buffer.concat([bytes.subarray(split), bytes, bytes]));
  assert.equal(received.length, 3);
  assert.ok(received.every((value) => value.params.text === "界"));
});

test("official Protocol rejects a partial line before parsing and rejects pending and future requests", async (t) => {
  const failures = [];
  const { input, transport } = endpoint(t, 32, (error) => failures.push(error));
  const pending = transport.request("initialize", {});
  input.write(Buffer.alloc(32, 120));
  assert.equal(failures.length, 0);
  input.write(Buffer.from("x"));
  await assert.rejects(pending, { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  await assert.rejects(transport.request("shutdown", {}), { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  assert.equal(failures.length, 1);
  assert.equal(input.listenerCount("data"), 0);
});

test("official Protocol enforces response limits and stops later notifications in the same chunk", async (t) => {
  const { input, output, transport } = endpoint(t, 128);
  let received = 0;
  transport.onNotification(() => received++);
  const pending = transport.request("initialize", {});
  const { id } = JSON.parse(output.read().toString());
  input.write(
    JSON.stringify({ jsonrpc: "2.0", id, result: { padding: "x".repeat(129) } }) +
      "\n" +
      JSON.stringify({ method: "fixture" }) +
      "\n"
  );
  await assert.rejects(pending, { code: "PROVIDER_MESSAGE_TOO_LARGE" });
  assert.equal(received, 0);
});
