import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ComponentStartError,
  startExtra,
  startOwnedKernel,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { waitFor } from "./runtime-fixture.js";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function startupFixture(t) {
  const home = await mkdtemp(join(tmpdir(), "ocs-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return {
    home,
    pidFile: join(home, "worker-pid"),
    options: {
      endpoint: componentEndpoint(home),
      stateDirectory: home,
      workerEntrypoint: resolve("test/fixtures/delayed-startup-worker.mjs"),
      env: { ...process.env, OCTO_TEST_WORKER_PID: join(home, "worker-pid") }
    }
  };
}
async function identities(t, fixture) {
  let identity;
  await waitFor(async () => {
    try {
      const worker = Number(await readFile(fixture.pidFile, "utf8"));
      const manifest = JSON.parse(
        await readFile(join(fixture.home, "kernel-invocations.json"), "utf8")
      );
      if (manifest.worker?.pid !== worker) return false;
      identity = { worker, kernel: manifest.kernelPid };
      return true;
    } catch {
      return false;
    }
  }, 15_000);
  t.after(() => {
    for (const pid of Object.values(identity)) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });
  return identity;
}
async function assertReleased(fixture, identity) {
  await waitFor(() => !alive(identity.worker) && !alive(identity.kernel), 10_000);
  await assert.rejects(access(join(fixture.home, "kernel-invocations.json")), { code: "ENOENT" });
  if (process.platform !== "win32") {
    await assert.rejects(access(fixture.options.endpoint), { code: "ENOENT" });
    await assert.rejects(access(`${fixture.options.endpoint}.owner`), { code: "ENOENT" });
  }
  const replacement = await startOwnedKernel({
    ...fixture.options,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js")
  });
  assert.equal((await replacement.stop()).complete, true);
}

test(
  "owner exit during Kernel readiness rolls back worker, endpoint and lease",
  { timeout: 30_000 },
  async (t) => {
    const fixture = await startupFixture(t);
    const owner = fork(
      resolve("test/fixtures/startup-owner.mjs"),
      [JSON.stringify(fixture.options)],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      }
    );
    t.after(() => {
      if (owner.exitCode === null) owner.kill("SIGKILL");
    });
    const identity = await identities(t, fixture);
    const exited = once(owner, "exit");
    owner.send("exit");
    await exited;
    await assertReleased(fixture, identity);
  }
);

test(
  "cancelling Kernel startup interrupts readiness and completes rollback",
  { timeout: 30_000 },
  async (t) => {
    const fixture = await startupFixture(t);
    const controller = new AbortController();
    const starting = startOwnedKernel({ ...fixture.options, signal: controller.signal });
    void starting.catch(() => undefined);
    const identity = await identities(t, fixture);
    controller.abort();
    await assert.rejects(starting, (error) => {
      assert.ok(error instanceof ComponentStartError);
      assert.equal(error.cleanup.complete, true);
      return true;
    });
    await assertReleased(fixture, identity);
  }
);

test("Extra initialization failure preserves rollback facts and blocks failed disposal replacement", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oes-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const trace = join(home, "trace");
  const options = {
    endpoint: componentEndpoint(home),
    declaration: {
      name: "startup-extra",
      module: resolve("test/fixtures/startup-extra.mjs"),
      config: { trace, failStart: true }
    }
  };
  await assert.rejects(startExtra(options), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.message, "EXTRA_START_FAILED");
    assert.equal(error.cleanup.complete, true);
    return true;
  });
  const extra = await startExtra({
    ...options,
    declaration: { ...options.declaration, config: { trace } }
  });
  assert.equal((await extra.stop()).complete, true);
  options.declaration.config.failDispose = true;
  await assert.rejects(startExtra(options), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.cleanup.complete, false);
    assert.equal(error.cleanup.processExited, true);
    return true;
  });
  await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
  assert.equal(
    await readFile(trace, "utf8"),
    "initialize\ndispose\ninitialize\ndispose\ninitialize\ndispose\n"
  );
});

test("failed Kernel restart retains replacement cleanup instead of the old stopped handle", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "ork-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const kernel = await startOwnedKernel({
    endpoint: componentEndpoint(home),
    stateDirectory: home,
    workerEntrypoint: resolve("test/fixtures/direct-adapter-host.js"),
    entrypoint: resolve("test/fixtures/restart-startup-failure.mjs")
  });
  await assert.rejects(kernel.restart(), (error) => {
    assert.ok(error instanceof ComponentStartError);
    assert.equal(error.cleanup.complete, false);
    return true;
  });
  assert.equal((await kernel.stop()).complete, false);
  await assert.rejects(kernel.restart(), /COMPONENT_CLEANUP_INCOMPLETE/);
  assert.equal(await readFile(join(home, "launch-count"), "utf8"), "2");
});

test(
  "Extra startup rollback includes unfinished host dependency ownership",
  { timeout: 10_000 },
  async (t) => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release([]));
    let calls = 0;
    const options = {
      endpoint: "/unused-kernel.sock",
      declaration: {
        name: "startup-proxy",
        module: resolve("test/fixtures/startup-proxy-extra.mjs"),
        config: {}
      },
      dependencies: {
        loadContexts: () => {
          calls++;
          return pending;
        }
      }
    };
    await assert.rejects(startExtra(options), (error) => {
      assert.ok(error instanceof ComponentStartError);
      assert.equal(error.cleanup.complete, false);
      assert.equal(error.cleanup.processExited, true);
      assert.ok(error.cleanup.pendingResources.includes("loadContexts"));
      assert.ok(error.cleanup.errors.some(({ code }) => code === "DEPENDENCY_CLEANUP_INCOMPLETE"));
      return true;
    });
    assert.equal(calls, 1);
    await assert.rejects(startExtra(options), /EXTRA_DISPOSE_FAILED/);
  }
);
