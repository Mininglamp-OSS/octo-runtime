import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const guard = fileURLToPath(new URL("./verify-startup-guard.mjs", import.meta.url));
// 仅传运行/模块加载所需环境，避免继承 Provider、Bot 凭据或 NODE_OPTIONS 等隐式行为。
const env = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL"
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]])
);
let checks = 0;

function run(args, overrides = {}) {
  const result = spawnSync(process.execPath, ["--import", guard, ...args], {
    cwd: root,
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1 << 20,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `Child terminated: ${result.signal}`);
  return result;
}

function startup(script, adapters, overrides) {
  const result = run([join(root, "scripts", script), "--check-startup"], overrides);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /QA_STARTUP_SIDE_EFFECT/);
  assert.deepEqual(JSON.parse(result.stdout), {
    check: "startup",
    script,
    adapters: [...adapters].sort(),
    cleanup: "complete"
  });
  checks++;
  console.log(JSON.stringify({ script, passed: true, ...JSON.parse(result.stdout) }));
}

function rejected(script, args, diagnostic) {
  const result = run([join(root, "scripts", script), ...args]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, diagnostic);
  assert.doesNotMatch(result.stderr, /QA_STARTUP_SIDE_EFFECT/);
  assert.equal(result.stdout, "");
  checks++;
}

startup("verify-actmode-live.mjs", ["codex", "claude-code", "kimi-code", "opencode", "mcode"]);
startup("verify-codex-forwarding-live.mjs", ["codex"]);
startup("verify-im-context-live.mjs", ["codex"]);
startup("verify-im-context-live.mjs", ["codex"], {
  OCTO_CHANNEL_QA_ACCOUNTS: join(root, "node_modules", "ort159-absent-qa-accounts.md")
});

for (const args of [
  ["--check-startup", "--check-endpoint", "unused-receipt.json"],
  ["--check-endpoint", "unused-receipt.json", "--check-startup"]
])
  rejected("verify-codex-forwarding-live.mjs", args, /QA_STARTUP_ENDPOINT_CONFLICT/);
for (const mode of ["--delivery", "--delivery-disconnect"])
  rejected("verify-im-context-live.mjs", ["--check-startup", mode], /QA_WS_DELIVERY_MODES_REMOVED/);

for (const script of [
  "verify-actmode-live.mjs",
  "verify-codex-forwarding-live.mjs",
  "verify-im-context-live.mjs"
]) {
  const result = run([join(root, "scripts", script), "--check-startup"], {
    OCTO_QA_REMOVED_EXPORT_SCRIPT: script
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /does not provide an export named 'AgentExecutor'|AgentExecutor is not a constructor/
  );
  assert.doesNotMatch(result.stderr, /QA_STARTUP_SIDE_EFFECT/);
  assert.equal(result.stdout, "");
  checks++;
}

// 真实执行受保护 API，确认 guard 在脚本加载前生效，包括 ESM 具名导入与吞掉异常的情况。
for (const source of [
  "await fetch('http://127.0.0.1:1')",
  "import { get } from 'node:http'; get('http://127.0.0.1:1')",
  "import { request } from 'node:https'; request('https://127.0.0.1:1')",
  "import { connect } from 'node:net'; connect(1, '127.0.0.1')",
  "import { Socket } from 'node:net'; new Socket().connect(1, '127.0.0.1')",
  "import { connect } from 'node:tls'; connect(1, '127.0.0.1')",
  "import { spawn } from 'node:child_process'; spawn(process.execPath, ['--version'])",
  "import { execFileSync } from 'node:child_process'; execFileSync(process.execPath, ['--version'])",
  "try { await fetch('http://127.0.0.1:1'); } catch {}"
]) {
  const result = run(["--input-type=module", "--eval", source]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /QA_STARTUP_SIDE_EFFECT/);
  checks++;
}
console.log(JSON.stringify({ check: "startup-suite", checks, passed: true }));
