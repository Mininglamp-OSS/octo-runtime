import assert from "node:assert/strict";
import { execFile, spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { appendFile, chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { promisify } from "node:util";
import {
  readQaAccounts,
  readVerificationTrace,
  stopCliComponent,
  verificationFailure,
  withVerificationCleanup
} from "../scripts/mimo-code-verification.mjs";

const execute = promisify(execFile);

test("MiMo trace polling waits for newline-complete records without hiding corruption", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mimo-trace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "trace.jsonl");
  assert.deepEqual(await readVerificationTrace(file), []);
  await writeFile(file, '{"type":"session.update"}\n{"type":"run.comp');
  assert.deepEqual(await readVerificationTrace(file), [{ type: "session.update" }]);
  await appendFile(file, 'leted"}');
  assert.deepEqual(await readVerificationTrace(file), [{ type: "session.update" }]);
  await appendFile(file, "\n");
  assert.deepEqual(await readVerificationTrace(file), [
    { type: "session.update" },
    { type: "run.completed" }
  ]);
  await appendFile(file, "invalid-json\n");
  await assert.rejects(readVerificationTrace(file), SyntaxError);
  await assert.rejects(readVerificationTrace(root), { code: "EISDIR" });
});

test("MiMo QA accounts require a bounded private regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "mimo-qa-file-"));
  const file = join(root, "accounts.md");
  try {
    const token = ["bf", randomUUID()].join("_");
    await writeFile(
      file,
      `Bot Name: fixture\nBot ID: fixture-bot\nBot Token: ${token}\nAPI Server: fixture-api\n`,
      { mode: 0o600 }
    );
    assert.deepEqual(await readQaAccounts(file), [
      { id: "fixture-bot", token, api: "fixture-api" }
    ]);
    if (process.platform !== "win32") {
      await chmod(file, 0o644);
      await assert.rejects(readQaAccounts(file), /MIMO_QA_FILE_PERMISSIONS_INVALID/);
      await chmod(file, 0o600);
      const link = join(root, "link.md");
      await symlink(file, link);
      await assert.rejects(readQaAccounts(link));
      const fifo = join(root, "fifo");
      execFileSync("mkfifo", [fifo]);
      await assert.rejects(readQaAccounts(fifo), /MIMO_QA_FILE_PERMISSIONS_INVALID/);
    }
    await assert.rejects(readQaAccounts(root), /MIMO_QA_FILE_PERMISSIONS_INVALID/);
    await writeFile(file, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(readQaAccounts(file), /MIMO_QA_FILE_TOO_LARGE/);
    await assert.rejects(readQaAccounts(join(root, "missing")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function unresponsiveChild(kill) {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    kill,
    unref() {
      this.unreferenced = true;
    }
  });
  return child;
}

for (const failure of ["false", "throw"]) {
  test(`MiMo cleanup remains bounded when kill returns ${failure}`, async () => {
    const signals = [];
    const child = unresponsiveChild((signal) => {
      signals.push(signal);
      if (failure === "throw") throw Object.assign(new Error("fixture"), { code: "EPERM" });
      return false;
    });
    const start = performance.now();
    await assert.rejects(
      stopCliComponent(child, { termGraceMs: 20, killGraceMs: 20 }),
      (error) => error.cleanupComplete === false && error.pid === child.pid
    );
    assert.ok(performance.now() - start < 2000);
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.unreferenced, true);
    assert.equal(child.listenerCount("close"), 0);
    assert.equal(child.listenerCount("error"), 0);
  });
}

test(
  "MiMo cleanup accepts confirmed graceful component exit",
  { skip: process.platform === "win32" },
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000);'
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    try {
      await once(child.stdout, "data");
      await stopCliComponent(child, { termGraceMs: 2000, killGraceMs: 100 });
      assert.equal(child.exitCode, 0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "close");
        child.kill("SIGKILL");
        await closed;
      }
    }
  }
);

test("MiMo CLI cancellation accepts confirmed exit 130 after SIGINT", async () => {
  const signals = [];
  const child = unresponsiveChild((signal) => {
    signals.push(signal);
    queueMicrotask(() => child.emit("close", 130, null));
    return true;
  });
  await stopCliComponent(child, { gracefulSignal: "SIGINT", allowedExitCodes: [0, 130] });
  assert.deepEqual(signals, ["SIGINT"]);
});

test("MiMo forced component exit fails acceptance even after close", async () => {
  const child = unresponsiveChild((signal) => {
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, signal));
    return true;
  });
  await assert.rejects(
    stopCliComponent(child, { termGraceMs: 10, killGraceMs: 100 }),
    /MIMO_COMPONENT_CLEANUP_FAILED/
  );
});

test("MiMo cleanup attempts every independent resource and preserves all failures", async () => {
  const original = new Error("verification fixture");
  const extraFailure = new Error("Extra fixture");
  const childFailure = new Error("child fixture");
  const attempts = [];
  await assert.rejects(
    withVerificationCleanup(async () => {
      throw original;
    }, [
      async () => {
        attempts.push("extra");
        throw extraFailure;
      },
      async () => {
        attempts.push("kernel");
      },
      async () => {
        attempts.push("child");
        throw childFailure;
      },
      async () => {
        attempts.push("descendants");
      }
    ]),
    (error) => {
      assert.equal(error.cleanupComplete, false);
      assert.deepEqual(error.errors, [original, extraFailure, childFailure]);
      return true;
    }
  );
  assert.deepEqual(attempts, ["extra", "kernel", "child", "descendants"]);
  await assert.rejects(
    withVerificationCleanup(async () => {
      throw original;
    }, [async () => {}]),
    (error) => error === original
  );
  assert.equal(await withVerificationCleanup(async () => "passed", [async () => {}]), "passed");
});

test("MiMo diagnostic output excludes upstream credentials and error bodies", () => {
  const sensitive = randomUUID();
  const nested = Object.assign(new Error(sensitive), {
    pid: 12345,
    exitCode: 5,
    stderr: sensitive
  });
  const failure = Object.assign(new AggregateError([nested], sensitive, { cause: nested }), {
    cleanupComplete: false
  });
  assert.deepEqual(verificationFailure(failure), {
    cleanupComplete: false,
    processes: [{ pid: 12345, exitCode: 5 }]
  });
  assert.ok(!JSON.stringify(verificationFailure(failure)).includes(sensitive));
});

test(
  "MiMo probes omit rejected credential contents and external error bodies",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mimo-qa-output-"));
    try {
      const file = join(root, "accounts.md");
      const sensitive = randomUUID();
      await writeFile(file, sensitive, { mode: 0o600 });
      await chmod(file, 0o644);
      const executable = join(root, "mimo");
      await writeFile(
        executable,
        `#!/usr/bin/env node
if (process.argv.includes("--version")) console.log("0.9.99");
else { console.error(${JSON.stringify(sensitive)}); process.exit(1); }
`,
        { mode: 0o700 }
      );
      for (const [script, expectedCode] of [
        ["scripts/verify-mimo-code-gateway.mjs", "MIMO_GATEWAY_VERIFICATION_FAILED"],
        ["scripts/verify-mimo-code.mjs", "MIMO_VERIFICATION_FAILED"]
      ])
        await assert.rejects(
          execute(process.execPath, [script], {
            cwd: new URL("..", import.meta.url),
            env: {
              ...process.env,
              PATH: [root, dirname(process.execPath), process.env.PATH].join(delimiter),
              TMPDIR: root,
              OCTO_CHANNEL_QA_ACCOUNTS: file
            },
            timeout: 10000
          }),
          (error) => {
            assert.equal(error.code, 1);
            assert.equal(error.stdout.includes(sensitive), false);
            assert.equal(error.stderr.includes(sensitive), false);
            assert.equal(error.stderr.includes(file), false);
            const diagnostics = error.stderr
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
            assert.equal(diagnostics.at(-1).code, expectedCode);
            return true;
          }
        );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
