// 从仓库根目录启动；测试宿主拥有临时 Kernel，原生客户端只 attach。
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    language: { type: "string", default: "all" },
    suite: { type: "string", default: "all" },
    evidence: { type: "string", default: ".tmp/native-evidence.json" }
  }
});
const languages = values.language === "all" ? ["go", "rust", "python"] : [values.language];
const suites =
  values.suite === "all"
    ? ["protocol", "interop", "faults", "lifecycle", "playboard-demo", "package"]
    : [values.suite];
if (languages.some((x) => !["go", "rust", "python"].includes(x)))
  throw Error("--language must be go, rust, python or all");
if (
  suites.some(
    (x) => !["protocol", "interop", "faults", "lifecycle", "playboard-demo", "package"].includes(x)
  )
)
  throw Error("Unknown suite");
const evidence = {
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  provider: "isolated fake Provider; real Kernel IPC",
  results: []
};
try {
  for (const language of languages) {
    const start = Date.now();
    const status = await new Promise((yes, no) => {
      const p = spawn(
        process.execPath,
        ["--test", "--test-concurrency=1", ...suites.map((x) => `native/tests/${x}.test.mjs`)],
        { stdio: "inherit", env: { ...process.env, OCTO_NATIVE_LANGUAGE: language } }
      );
      p.once("error", no);
      p.once("exit", (code) => yes(code));
    });
    evidence.results.push({ language, suites, status, durationMs: Date.now() - start });
    if (status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await mkdir(dirname(resolve(values.evidence)), { recursive: true });
  await writeFile(values.evidence, JSON.stringify(evidence, null, 2) + "\n");
}
