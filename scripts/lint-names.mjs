import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv.indexOf("--root");
if (rootArg >= 0 && !process.argv[rootArg + 1]) throw new Error("--root requires a directory");
const root = resolve(
  rootArg >= 0 ? process.argv[rootArg + 1] : fileURLToPath(new URL("..", import.meta.url))
);
const legacy = [
  ["octo", "harness"].join("-"),
  ["OCTO", "HARNESS"].join("_"),
  ["Octo", "Harness"].join(""),
  ["Octo", "Harness"].join(" ")
];
function containsLegacy(value, name) {
  // Environment prefixes are case-sensitive; historical database names are not package names.
  return name === legacy[1]
    ? value.includes(name)
    : value.toLowerCase().includes(name.toLowerCase());
}
// Issue #22 的原始路径属于不可改写的历史证据。仅允许已核验的完整内容快照；
// 任意内容变更都须重新审核，不能把文件或目录整体排除于命名检查之外。
// 统一 CRLF/LF 后校验，以兼容 Windows checkout；此例外不改变 Gitleaks 扫描规则。
const historicalEvidence = new Map([
  [".gitleaksignore", "9261fbfaaa21f314aad7641eb9f3779adbc7649dc627e591699d12766814d736"],
  [
    ".octospec/tasks/gitleaks-history-triage/findings.md",
    "df331c61f2eaea9e18a36ae2150ff053f56bd555c11e57df0c2653e809ed7d70"
  ]
]);
const excluded = [".git", "node_modules", "dist", "out", "release", ".worktree", ".workbuddy"];
const spawnOptions = { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 };
function fallbackFiles() {
  // Git preserves ignore rules without relying on rg being an executable on PATH.
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z", "--", "."],
    spawnOptions
  );
  if (git.error) throw git.error;
  if (git.status === 0) {
    const files = git.stdout.split("\0").filter(Boolean);
    const ignored = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
      ...spawnOptions,
      input: files.length ? files.join("\0") + "\0" : ""
    });
    if (ignored.error || ![0, 1].includes(ignored.status))
      throw ignored.error ?? new Error(ignored.stderr);
    const ignoredFiles = new Set(ignored.stdout.split("\0"));
    return files.filter((file) => {
      if (ignoredFiles.has(file) || file.split("/").some((part) => excluded.includes(part)))
        return false;
      if (file.split("/").at(-1) === "secret.md") return false;
      try {
        return lstatSync(resolve(root, file)).isFile();
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    });
  }
  const repository = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], spawnOptions);
  if (repository.error || repository.status === 0) throw repository.error ?? new Error(git.stderr);

  // Temporary non-Git fixtures need no external file enumerator; never follow symlinks.
  function walk(directory = "") {
    return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
      if (excluded.includes(entry.name) || entry.name === "secret.md") return [];
      const file = directory ? `${directory}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
    });
  }
  return walk();
}
const args = [
  "--files",
  "--hidden",
  "-0",
  ...excluded.flatMap((name) => ["-g", `!**/${name}/**`, "-g", `!**/${name}`]),
  "-g",
  "!**/secret.md"
];
const result = spawnSync("rg", args, spawnOptions);
const missingRg = result.error?.code === "ENOENT";
if (!missingRg && (result.error || (result.status !== 0 && result.status !== 1)))
  throw result.error ?? new Error(result.stderr);
const files = missingRg ? fallbackFiles() : result.stdout.split("\0").filter(Boolean);
const findings = [],
  exceptions = [];
for (const file of files) {
  if (legacy.some((name) => containsLegacy(file, name))) findings.push({ file, kind: "path" });
  const bytes = readFileSync(resolve(root, file));
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  const evidenceHash = historicalEvidence.get(file.replaceAll("\\", "/"));
  const verifiedEvidence =
    evidenceHash !== undefined &&
    createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex") === evidenceHash;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const names = legacy.filter((name) => containsLegacy(line, name));
    if (!names.length) continue;
    const entry = { file, line: index + 1, names };
    const requiredHistory =
      file.replaceAll("\\", "/") === "docs/octo-runtime-rename-ipd-se.md" &&
      line.startsWith("架构评审指出：`" + legacy[0] + "` 命名有歧义") &&
      names.length === 1 &&
      line.split(legacy[0]).length === 2;
    if (requiredHistory)
      exceptions.push({ ...entry, reason: "Explicitly required architecture-review history" });
    else if (verifiedEvidence)
      exceptions.push({ ...entry, reason: "Reviewed Issue #22 historical evidence snapshot" });
    else findings.push(entry);
  }
}
console.log(
  JSON.stringify(
    {
      root: relative(process.cwd(), root) || ".",
      scannedFiles: files.length,
      findings,
      exceptions,
      excluded,
      respectsGitIgnore: true
    },
    null,
    2
  )
);
process.exitCode = findings.length ? 1 : 0;
