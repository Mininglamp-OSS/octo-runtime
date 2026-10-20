import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { runCli } from "../apps/cli/dist/main.js";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint, componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
import { waitFor } from "./runtime-fixture.js";

for (const mode of ["hang", "reject", "startup-failure"]) {
  test(
    `CLI exits after incomplete cleanup despite a referenced timer (${mode})`,
    { timeout: 15_000, skip: process.platform === "win32" && mode !== "startup-failure" },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "ocx-"));
      t.after(() => rm(home, { recursive: true, force: true }));
      assert.equal(
        await runCli(["--home", home, "extraset", "channel-gateway"], {
          input: Readable.from([
            JSON.stringify({
              module: resolve("test/fixtures/stuck-cli-extra.mjs"),
              config: { mode }
            })
          ]),
          output() {}
        }),
        0
      );
      const child = spawn(
        process.execPath,
        [resolve("apps/cli/dist/index.js"), "--home", home, "channel-gateway", "run"],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const exited = new Promise((resolve, reject) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
        child.once("error", reject);
      });
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      });
      await waitFor(() => {
        if (child.exitCode !== null) throw new Error(output + errors);
        return output.includes(
          mode === "startup-failure" ? "SERVICE_INITIALIZATION_FAILED" : '"state":"ready"'
        );
      }, 5000);
      const started = Date.now();
      if (mode !== "startup-failure") child.kill("SIGTERM");
      let timer;
      try {
        const result = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`CLI did not exit: ${output}${errors}`)),
              7000
            );
          })
        ]);
        assert.deepEqual(result, { code: 5, signal: null });
        assert.ok(Date.now() - started < 7000);
        if (mode === "startup-failure") assert.match(output, /SERVICE_INITIALIZATION_FAILED/);
      } finally {
        clearTimeout(timer);
      }
    }
  );
}

test(
  "foreground components stop independently and report Kernel availability without implicit startup",
  { timeout: 20_000 },
  async (t) => {
    const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ocf-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    assert.equal(
      await runCli(["--home", home, "extraset", "channel-gateway"], {
        input: Readable.from([
          JSON.stringify({
            module: "@mininglamp-oss/octo-runtime-extra-channel-gateway",
            config: { bots: [] }
          })
        ]),
        output() {}
      }),
      0
    );
    const processes = [];
    async function start(component) {
      const child = spawn(
        process.execPath,
        [
          resolve("apps/cli/dist/index.js"),
          "--home",
          home,
          component,
          "run",
          "--manifest",
          resolve("test/fixtures/adapters.json")
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      const entry = {
        child,
        output: "",
        errors: "",
        exited: new Promise((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        })
      };
      processes.push(entry);
      child.stdout.on("data", (chunk) => {
        entry.output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        entry.errors += chunk;
      });
      await waitFor(() => {
        if (child.exitCode !== null) throw Error(entry.output + entry.errors);
        return entry.output.includes('"state":"ready"');
      }, 10_000);
      return entry;
    }
    async function stop(entry) {
      if (entry.child.exitCode === null && entry.child.signalCode === null)
        entry.child.kill("SIGTERM");
      await entry.exited;
    }
    t.after(async () => {
      for (const entry of processes.reverse()) await stop(entry);
    });
    const gateway = await start("channel-gateway");
    const status = async () => {
      let value;
      assert.equal(
        await runCli(["--home", home, "status"], {
          output: (line) => {
            value = JSON.parse(line);
          }
        }),
        0
      );
      return value;
    };
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    assert.equal((await status())["channel-gateway"].runtime.pid, gateway.child.pid);
    const kernel = await start("executor-kernel");
    const client = attachKernel({ endpoint: componentEndpoint(home) });
    t.after(() => client.close());
    const instance = (await client.status()).kernel_instance_id;
    assert.equal((await client.status()).pid, kernel.child.pid);
    const calls = [];
    const backend = {
      inspect: async () => ({ state: "stopped", enabled: false, drift: [] }),
      start: async (spec) => calls.push(["start", spec.id]),
      restart: async (spec) => calls.push(["restart", spec.id])
    };
    for (const component of ["executor-kernel", "channel-gateway"]) {
      for (const action of ["start", "restart"]) {
        const before = calls.length;
        assert.equal(
          await runCli(["--home", home, component, action], { backend, output() {} }),
          0
        );
        assert.equal(calls.length, before + 1);
        assert.deepEqual(calls.at(-1), [action, componentServiceId(home, component)]);
      }
    }
    await stop(gateway);
    assert.equal(gateway.child.exitCode, 0);
    assert.equal((await client.status()).kernel_instance_id, instance);
    const next = await start("channel-gateway");
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, true);
    await stop(kernel);
    assert.equal(kernel.child.exitCode, 0);
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    assert.equal(next.child.exitCode, null);
    await stop(next);
    assert.equal(next.child.exitCode, 0);
  }
);
