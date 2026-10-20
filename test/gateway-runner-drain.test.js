import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startExtra } from "@mininglamp-oss/octo-runtime-host-sdk";
import { kernelFixture, kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";

test(
  "independent Gateway drains its accepted Kernel run before stop ACK and preserves a sibling",
  { timeout: 10000 },
  async (t) => {
    const { client, endpoint, directory } = await kernelFixture(t, {
      workerEntrypoint: resolve("test/fixtures/drain-worker.mjs"),
      manifest: undefined
    });
    const sibling = await client.submit(kernelInput("sibling"));
    const trace = join(directory, "drain.ndjson");
    const records = async () => (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse);
    const extra = await startExtra({
      endpoint,
      declaration: {
        name: "drain-gateway",
        module: resolve("test/fixtures/drain-gateway-extra.mjs"),
        config: { trace }
      }
    });
    t.after(() => extra.stop());
    await waitFor(async () =>
      (await records()).some((item) => item.type === "accepted.tail")
    ).catch(async (error) => {
      throw new Error(JSON.stringify({ status: await extra.status(), records: await records() }), {
        cause: error
      });
    });
    const result = await extra.stop();
    assert.equal(result.complete, true, JSON.stringify({ result, records: await records() }));
    const events = await records();
    const stop = events.findIndex((item) => item.type === "cancel.ack");
    const binding = events.findIndex(
      (item) => item.type === "binding" && item.session === "drained-provider-session"
    );
    const final = events.findIndex((item) => item.type === "final");
    const close = events.findIndex(
      (item, index) => index > stop && item.type === "connector.close"
    );
    assert.ok(
      stop >= 0 && binding > stop && final > binding && close > final,
      JSON.stringify(events)
    );
    assert.equal(events.filter((item) => item.type === "invoke").length, 1);
    assert.equal(events.filter((item) => item.type === "final").length, 1);
    assert.equal((await client.get(sibling.ref)).terminal, undefined);
    assert.equal((await client.status()).execution_ready, true);
    await client.cancel(sibling.ref);
    await frames(client, sibling.ref);
  }
);
