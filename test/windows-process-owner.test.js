import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  spawnManaged,
  managedIdentity,
  managedCleanup
} from "../packages/octo-runtime-adapter-sdk/dist/managed-process.js";
import { waitFor } from "./runtime-fixture.js";

const windows = {
  skip: process.platform !== "win32" ? "requires native Windows Job Objects" : false,
  timeout: 20000
};
const fixture = resolve("test/fixtures/windows-process-owner.mjs");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  "Windows Job owns immediate descendants and preserves Node IPC, argv, env and cwd",
  windows,
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "owner spaces-中文-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const args = ["one two", 'quotes"and\\slashes', "中文", "&|<>^%"];
    const child = spawnManaged(process.execPath, [fixture, "target", ...args], {
      cwd: directory,
      env: { ...process.env, OCTO_TEST_OWNER: "unchanged" },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    t.after(() => managedCleanup(child)());
    const message = once(child, "message");
    const closed = once(child, "close");
    const identity = await managedIdentity(child);
    const [actual] = await message;
    assert.notEqual(identity.pid, child.pid);
    assert.equal(actual.pid, identity.pid);
    assert.match(identity.started, /^windows:\d+$/);
    assert.deepEqual(actual.args, args);
    assert.equal(actual.cwd, directory);
    assert.equal(actual.env, "unchanged");
    assert.equal(alive(actual.descendant), true);
    const echo = once(child, "message");
    child.send({ type: "dependency.call", id: "original", payload: "data" });
    assert.deepEqual((await echo)[0], {
      echo: { type: "dependency.call", id: "original", payload: "data" }
    });
    child.send("exit");
    assert.equal((await closed)[0], 0);
    await managedCleanup(child)();
    assert.equal(alive(actual.pid), false);
    assert.equal(alive(actual.descendant), false);
  }
);

test("Windows Job returns raw target stdout and confirms repeated cleanup", windows, async () => {
  const child = spawnManaged(process.execPath, [
    "-e",
    "console.log(JSON.stringify({original:true}));setInterval(()=>{},1000)"
  ]);
  let stdout = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  const identity = await managedIdentity(child);
  await waitFor(() => stdout.includes("\n"));
  assert.deepEqual(JSON.parse(stdout), { original: true });
  const cleanup = managedCleanup(child);
  assert.equal(cleanup(), cleanup());
  await cleanup();
  assert.equal(alive(identity.pid), false);
});

for (const kill of ["owner", "broker"]) {
  test(
    `Windows Job reclaims the target and descendants after ${kill} exits`,
    windows,
    async (t) => {
      const owner = fork(fixture, ["owner"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      const exited = once(owner, "exit");
      t.after(() => {
        if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
      });
      const [identity] = await once(owner, "message");
      assert.equal(alive(identity.descendant), true);
      if (kill === "owner") {
        owner.send("exit");
        await exited;
      } else process.kill(identity.broker, "SIGKILL");
      await waitFor(() => !alive(identity.target) && !alive(identity.descendant), 10000);
    }
  );
}

test("Windows Job fails closed for a missing executable", windows, async () => {
  const child = spawnManaged("octo-runtime-nonexistent-command", []);
  const closed = once(child, "close");
  await assert.rejects(managedIdentity(child), /WINDOWS_PROCESS_START_FAILED/);
  assert.equal((await closed)[0], 125);
  await assert.rejects(
    managedCleanup(child)(),
    /PROCESS_TREE_CLEANUP_INCOMPLETE|WINDOWS_PROCESS_START_FAILED/
  );
});
