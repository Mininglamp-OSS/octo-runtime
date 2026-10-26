import assert from "node:assert/strict";
import test from "node:test";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  invocationEnvironment,
  invocationMcpServers,
  processEnvironmentValue,
  probeCommand
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { buildClaudeCommand } from "../packages/octo-runtime-adapter-claude-code/dist/index.js";
import { resolveDshLaunch } from "../packages/octo-runtime-adapter-dsh/dist/launch.js";
import { spawnAcpClient } from "../packages/octo-runtime-acp-client/dist/index.js";
import { spawnGrokBuildAcpClient } from "../packages/octo-runtime-adapter-grok-build/dist/client.js";
import {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  reapOrphanedInvocationManifest,
  processStartIdentity
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";
import { WindowsUserTaskBackend } from "../packages/octo-runtime-cross-service/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";
import { invokeRequest } from "./runtime-fixture.js";

const payload = (values) => ({
  env_variables: Object.entries(values).map(([key, value]) => ({ key, value }))
});
const request = (values, items = []) =>
  invokeRequest({
    context: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "envs", payload: payload(values) }, ...items]
    }
  });

test("environment consumers share platform key identity without reading inherited properties", (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  t.after(() => Object.defineProperty(process, "platform", platform));
  const env = Object.assign(Object.create({ inherited: "hidden" }), {
    Path: "native",
    path: "override"
  });
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  assert.equal(processEnvironmentValue(env, "PATH"), "override");
  assert.equal(processEnvironmentValue(env, "inherited"), undefined);
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  assert.equal(processEnvironmentValue(env, "PATH"), undefined);
  assert.equal(processEnvironmentValue(env, "Path"), "native");
});

test(
  "native Windows MCP, Claude, shared probe and DSH consume mixed-case overrides",
  { skip: process.platform !== "win32" },
  async () => {
    const req = request({ OCTO_CASE_URL: "https://example.invalid/mcp" }, [
      {
        namespace: "octo.execution",
        name: "mcp",
        payload: { mcpServers: { sample: { type: "streamable_http", url: "${OCTO_CASE_URL}" } } }
      }
    ]);
    req.executionEnvOverrides = payload({ octo_case_url: "https://example.invalid/mcp" });
    assert.equal(invocationMcpServers(req).sample.url, "https://example.invalid/mcp");
    const command = await buildClaudeCommand(req);
    await command.cleanup();
    const env = invocationEnvironment(
      request({ path: dirname(process.execPath), pathext: ".EXE" }),
      {},
      { PATH: "missing", PATHEXT: ".WRONG" }
    );
    assert.equal((await probeCommand(basename(process.execPath, ".exe"), { env })).available, true);
    const launch = await resolveDshLaunch(
      {
        command: basename(process.execPath, ".exe"),
        args: [fileURLToPath(new URL("./fixtures/dsh-runtime.mjs", import.meta.url))]
      },
      env
    );
    assert.equal(launch.command.toLowerCase(), process.execPath.toLowerCase());
  }
);

for (const [name, spawn] of [
  ["ACP", spawnAcpClient],
  ["Grok", spawnGrokBuildAcpClient]
]) {
  test(
    `native Windows ${name} final spawn preserves mixed-case override precedence`,
    { skip: process.platform !== "win32" },
    async (t) => {
      const key = "OCTO_REVIEW_CASE";
      const before = process.env[key];
      process.env[key] = "inherited";
      t.after(() => {
        if (before === undefined) delete process.env[key];
        else process.env[key] = before;
      });
      const env = invocationEnvironment(request({ octo_review_case: "invocation" }));
      const client = spawn({
        command: process.execPath,
        args: [
          "-e",
          `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id!==undefined) console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{value:process.env.OCTO_REVIEW_CASE}}));})`
        ],
        env
      });
      t.after(() => client.close());
      assert.deepEqual(await client.initialize(), { value: "invocation" });
      await client.close();
    }
  );
}

async function incompleteFixture(t) {
  const home = await mkdtemp(join(tmpdir(), "octo-review-recovery-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "run", "kernel-invocations.json");
  await mkdir(dirname(path));
  const manifest = {
    schemaVersion: 1,
    kernelPid: 2147483646,
    worker: { pid: 2147483645, started: "windows:100", entrypoint: "fixture" },
    invocations: [],
    cleanupIncomplete: true
  };
  await writeFile(path, JSON.stringify(manifest));
  return { home, path, manifest };
}

test("explicit orphan recovery keeps evidence, rejects a live owner and permits the next startup", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  manifest.kernelPid = process.pid;
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  manifest.kernelPid = 2147483646;
  manifest.worker.pid = process.pid;
  manifest.worker.started = await processStartIdentity(process.pid);
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  manifest.worker.pid = 2147483645;
  manifest.worker.started = "windows:100";
  await writeFile(path, JSON.stringify(manifest));
  const source = await readFile(path, "utf8");
  const recovery = await acknowledgeOrphanCleanup(path);
  assert.equal(await readFile(recovery.archivePath, "utf8"), source);
  assert.equal(await readFile(path, "utf8"), source);
  assert.equal((await inspectOrphanCleanup(path)).state, "acknowledged");
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const { manifest: opened, reap } = await InvocationManifest.open(path);
  assert.equal(reap.reason, "cleanup_acknowledged");
  assert.equal(reap.reaped, false, "operator acknowledgement is not verified tree cleanup");
  await opened.close();
  assert.equal(await readFile(recovery.archivePath, "utf8"), source);
});

test("acknowledgement requires the same manifest and an intact evidence archive", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  const { archivePath } = await acknowledgeOrphanCleanup(path);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  await writeFile(archivePath, "changed");
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  await writeFile(archivePath, JSON.stringify(manifest));
  await writeFile(path, JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }));
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
});

test("Windows incomplete evidence does not introduce a POSIX startup latch", async (t) => {
  const { path } = await incompleteFixture(t);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "host_missing");
});

test("CLI recover requires acknowledgement and doctor exposes the manifest path", async (t) => {
  const { home, path } = await incompleteFixture(t);
  let output = "";
  const capture = {
    output: (value) => {
      output = value;
    }
  };
  assert.equal(await runCli(["executor-kernel", "recover", "--home", home, "--json"], capture), 2);
  const backend = {
    kind: "windows-user-task",
    probe: async () => ({ manager: "windows-user-task", supported: true }),
    inspect: async () => ({
      manager: "windows-user-task",
      state: "not_installed",
      enabled: false,
      drift: []
    })
  };
  assert.equal(await runCli(["doctor", "--home", home, "--json"], { ...capture, backend }), 0);
  assert.equal(JSON.parse(output).recovery.manifestPath, path);
  assert.equal(JSON.parse(output).recovery.state, "cleanup_incomplete");
  assert.equal(
    await runCli(
      ["executor-kernel", "recover", "--acknowledge-orphan-cleanup", "--home", home, "--json"],
      capture
    ),
    0
  );
  const recovery = JSON.parse(output);
  assert.equal(recovery.manifestPath, path);
  assert.equal(JSON.parse(await readFile(recovery.archivePath, "utf8")).cleanupIncomplete, true);
});

for (const [matches, actual, expectedState] of [
  [null, "alice", "unknown"],
  [null, "DOMAIN\\alice", "stopped"],
  [false, "DOMAIN\\alice", "stopped"]
]) {
  test(`Windows SID result ${matches} with ${actual} distinguishes unknown from mismatch`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "octo-sid-review-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const spec = {
      id: "octo-review-sid",
      command: "C:\\node\\node.exe",
      args: [],
      workingDirectory: "C:\\home",
      enabled: true
    };
    const runner = {
      async run(command, args) {
        return {
          command,
          args,
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify(
            args.at(-1)?.includes("Schedule.Service")
              ? { exists: true }
              : {
                  state: "Ready",
                  enabled: true,
                  execute: spec.command,
                  arguments: "",
                  working_directory: spec.workingDirectory,
                  principal_user_id: actual,
                  principal_user_matches: matches,
                  principal_logon_type: "Interactive",
                  trigger_user_id: actual,
                  trigger_user_matches: matches
                }
          )
        };
      }
    };
    const backend = new WindowsUserTaskBackend({
      platform: "win32",
      runner,
      homeDirectory: directory,
      windowsUserId: "DOMAIN\\alice",
      windowsDefinitionDirectory: directory
    });
    await backend.install(spec);
    const status = await backend.inspect(spec);
    assert.equal(status.state, expectedState);
    assert.equal(status.drift.includes("manager.principal_user"), matches === false);
    if (expectedState === "unknown") {
      assert.match(status.detail, /identity could not be resolved/);
      await assert.rejects(backend.start(spec), { code: "MANAGER_UNAVAILABLE" });
    }
  });
}
