import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  runReleaseCommand,
  stopReleaseProcess,
  withReleaseDirectory
} from "../scripts/release-process.mjs";

const fixture = resolve("test/fixtures/release-command-tree.mjs");

async function waitForPid(file) {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    try {
      const pid = Number(await readFile(file, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(25);
  }
  throw new Error("release descendant did not start");
}

async function assertStopped(pid) {
  const until = Date.now() + 2_000;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal(error.code, "ESRCH");
      return;
    }
    await delay(25);
  }
  assert.fail(`release descendant ${pid} survived cleanup`);
}

test(
  "release timeout reaps a command's descendant before removing its working directory",
  { timeout: 20_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "orc-timeout-"));
    const marker = join(directory, "worker.pid");
    const started = Date.now();
    await withReleaseDirectory(directory, async () => {
      await assert.rejects(
        runReleaseCommand(process.execPath, [fixture, marker], { cwd: directory, timeout: 5_000 }),
        /Release command timed out/
      );
      await assertStopped(await waitForPid(marker));
    });
    assert.ok(Date.now() - started < 12_000, "command timeout must include bounded tree cleanup");
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  }
);

test("release command failures retain exit code and both diagnostic streams", async () => {
  await assert.rejects(
    runReleaseCommand(
      process.execPath,
      [
        "--eval",
        'console.log("fixture output"); console.error("fixture failure"); process.exitCode = 7;'
      ],
      { timeout: 5_000 }
    ),
    (error) => {
      assert.equal(error.code, 7);
      assert.match(error.stdout, /fixture output/);
      assert.match(error.stderr, /fixture failure/);
      return true;
    }
  );
});

test("release shutdown terminates the whole live tree before deleting the working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orc-stop-"));
  await withReleaseDirectory(directory, async () => {
    const marker = join(directory, "worker.pid");
    const child = spawn(process.execPath, [fixture, marker], {
      cwd: directory,
      detached: process.platform !== "win32",
      stdio: "ignore"
    });
    const closed = once(child, "close");
    try {
      const pid = await waitForPid(marker);
      await stopReleaseProcess(child);
      await closed;
      await assertStopped(pid);
    } finally {
      if (child.exitCode === null && child.signalCode === null) await stopReleaseProcess(child);
    }
  });
});

test("directory cleanup failure retains the original verification error and its diagnostics", async () => {
  const original = Object.assign(new Error("SDK fixture timed out"), { stderr: "startup detail" });
  const cleanup = Object.assign(new Error("directory locked"), { code: "EBUSY" });
  await assert.rejects(
    withReleaseDirectory(
      "fixture-only",
      async () => {
        throw original;
      },
      async () => {
        throw cleanup;
      }
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, original);
      assert.deepEqual(error.errors, [original, cleanup]);
      assert.equal(error.errors[0].stderr, "startup detail");
      return true;
    }
  );
});

test("successful directory removal still propagates the original verification failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orc-failure-"));
  const original = new Error("original verification failure");
  await assert.rejects(
    withReleaseDirectory(directory, async () => {
      throw original;
    }),
    (error) => error === original
  );
  await assert.rejects(rm(directory), { code: "ENOENT" });
});
