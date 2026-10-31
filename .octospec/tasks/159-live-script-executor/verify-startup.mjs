import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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

for (const args of [
  ["--unknown"],
  ["receipt.json", "--check-endpoint"],
  ["--check-endpoint"],
  ["--check-endpoint", "--check-endpoint"],
  ["--check-endpoint", "receipt.json", "extra"],
  ["--check-startup", "--check-startup"],
  ["--check-startup", "extra"],
  ["--unknown", "--check-endpoint", "receipt.json"],
  ["--check-endpoint", "receipt.json", "--check-endpoint", "receipt.json"]
])
  rejected("verify-codex-forwarding-live.mjs", args, /QA_FORWARDING_ARGS/);
for (const path of ["receipt.json", join(root, "receipt.json"), join(tmpdir(), "receipt.json")])
  rejected("verify-codex-forwarding-live.mjs", ["--check-endpoint", path], /QA_FORWARDING_RECEIPT/);

// endpoint 独立使用固定 HTTP 替身验证回执合同；不调用 Provider 或实网，不算 live 验收。
const directory = await realpath(await mkdtemp(join(tmpdir(), "octo-codex-forwarding-")));
try {
  const receiptPath = join(directory, "receipt.json");
  const fixture = `globalThis.fetch = async (url) => {
    if (url !== 'https://im.deepminer.com.cn/') throw new Error('Unexpected endpoint');
    process.stderr.write('QA_ENDPOINT_FETCH\\n');
    return {status: 200, body: {cancel: async () => {}}};
  };`;
  function endpoint(path) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(fixture)}`,
        join(root, "scripts/verify-codex-forwarding-live.mjs"),
        "--check-endpoint",
        path
      ],
      { cwd: directory, env, encoding: "utf8", timeout: 15000 }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  }
  let result = endpoint(receiptPath);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.endpoint, "https://im.deepminer.com.cn/");
  assert.equal(receipt.status, 200);
  assert.match(receipt.marker, /^FORWARDING_[0-9a-f-]+$/);
  assert.equal(result.stdout.trim(), receipt.marker);
  assert.match(result.stderr, /QA_ENDPOINT_FETCH/);
  checks++;
  result = endpoint(receiptPath);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/);
  assert.doesNotMatch(result.stderr, /QA_ENDPOINT_FETCH/);
  assert.deepEqual(JSON.parse(await readFile(receiptPath, "utf8")), receipt);
  checks++;
  result = endpoint(join(directory, "other.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /QA_FORWARDING_RECEIPT/);
  assert.doesNotMatch(result.stderr, /QA_ENDPOINT_FETCH/);
  checks++;
} finally {
  await rm(directory, { recursive: true, force: true });
}

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
  "import { Worker } from 'node:worker_threads'; new Worker('0', {eval: true})",
  "import cluster from 'node:cluster'; cluster.fork()",
  "import { writeFileSync } from 'node:fs'; writeFileSync('forbidden', 'x')",
  "import { writeFile } from 'node:fs/promises'; await writeFile('forbidden', 'x')",
  "import { mkdir } from 'node:fs/promises'; await mkdir('forbidden')",
  "import { openSync } from 'node:fs'; openSync('forbidden', 'w')",
  "import { openSync, constants } from 'node:fs'; openSync('forbidden', constants.O_CREAT | constants.O_WRONLY)",
  "import { createWriteStream } from 'node:fs'; createWriteStream('forbidden')",
  "import { writeFile } from 'node:fs'; writeFile('forbidden', 'x', () => {})",
  "import { open } from 'node:fs/promises'; await open('forbidden', 'a')",
  "import { open } from 'node:fs/promises'; const h = await open('package.json', 'r'); try { await h.chmod(0o600); } finally { await h.close(); }",
  "try { await fetch('http://127.0.0.1:1'); } catch {}"
]) {
  const result = run(["--input-type=module", "--eval", source]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /QA_STARTUP_SIDE_EFFECT/);
  checks++;
}
console.log(JSON.stringify({ check: "startup-suite", checks, passed: true }));
