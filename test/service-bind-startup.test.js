import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createExtraService, componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { withShutdownDeadline } from "@mininglamp-oss/octo-runtime-host-sdk/shutdown";
import { waitFor } from "./runtime-fixture.js";

async function delayedBind(t) {
  const home = await mkdtemp(join(tmpdir(), "obd-"));
  const endpoint = componentEndpoint(home);
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let server;
  let failure;
  const listen = net.Server.prototype.listen;
  const mocked = t.mock.method(net.Server.prototype, "listen", function (...args) {
    if (args[0] !== endpoint) return Reflect.apply(listen, this, args);
    server = this;
    entered.resolve();
    void resume.promise.then(() => {
      if (failure) this.emit("error", failure);
      else Reflect.apply(listen, this, args);
    });
    return this;
  });
  t.after(async () => {
    resume.resolve();
    mocked.mock.restore();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    endpoint,
    entered: entered.promise,
    resume: (error) => {
      failure ??= error;
      resume.resolve();
    },
    get server() {
      return server;
    }
  };
}

test("Kernel cancellation waits for in-flight bind then rolls back and releases the endpoint", async (t) => {
  const bind = await delayedBind(t);
  const options = {
    endpoint: bind.endpoint,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
  };
  const kernel = createKernelService(options);
  const controller = new AbortController();
  const initializing = kernel.initialize({ signal: controller.signal });
  const rejected = assert.rejects(initializing, (error) => error.cleanup.complete);
  await bind.entered;
  controller.abort();
  let closed = false;
  const closing = kernel.close().then((result) => {
    closed = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  bind.resume();
  await rejected;
  assert.equal((await closing).complete, true);
  assert.equal(bind.server.listening, false);
  const replacement = createKernelService(options);
  t.after(() => replacement.close());
  await replacement.initialize();
  assert.equal((await replacement.close()).complete, true);
});

for (const failBind of [false, true]) {
  test(`Extra closes a control bind settled after its cleanup deadline (failure=${failBind})`, async (t) => {
    const bind = await delayedBind(t);
    const options = {
      endpoint: componentEndpoint(bind.home, "kernel"),
      controlEndpoint: bind.endpoint,
      config: {},
      dependencies: {},
      module: { name: "late-control-bind", default: () => () => {} }
    };
    const extra = createExtraService(options);
    const controller = new AbortController();
    const initializing = extra.initialize({ signal: controller.signal });
    const rejected = assert.rejects(initializing, (error) => !error.cleanup.complete);
    await bind.entered;
    withShutdownDeadline(performance.now() + 80, () => controller.abort());
    await rejected;
    const cleanup = await extra.close();
    assert.equal(cleanup.complete, false);
    assert.ok(cleanup.pendingResources.includes("initialization"));
    assert.ok(cleanup.pendingResources.includes("control-server"));
    let lateClosed = false;
    bind.server.once("close", () => {
      lateClosed = true;
    });
    if (failBind) {
      bind.resume(new Error("BIND_FAILED"));
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      bind.resume();
      await waitFor(() => lateClosed);
      assert.equal(bind.server.listening, false);
    }
    assert.equal((await extra.status()).phase, "failed");
    if (process.platform !== "win32") {
      await assert.rejects(stat(bind.endpoint), { code: "ENOENT" });
      await stat(`${bind.endpoint}.owner`);
    }
    await assert.rejects(
      createExtraService(options).initialize(),
      (error) => error.cause?.message === "EXTRA_DISPOSE_FAILED"
    );
    assert.equal(await extra.close(), cleanup);
  });
}
