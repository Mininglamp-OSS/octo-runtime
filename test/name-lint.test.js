import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../scripts/lint-names.mjs", import.meta.url));
const previous = ["octo", "harness"].join("-");
const missingRgImport = `data:text/javascript,${encodeURIComponent(`
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, ...args) => command === "rg"
    ? { error: Object.assign(new Error("rg is unavailable"), { code: "ENOENT" }) }
    : original(command, ...args);
  syncBuiltinESMExports();
`)}`;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "runtime-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    run({ withoutRg = false } = {}) {
      const args = [...(withoutRg ? ["--import", missingRgImport] : []), script, "--root", root];
      const result = spawnSync(process.execPath, args, { encoding: "utf8" });
      assert.equal(result.error, undefined);
      assert.ok(result.stdout, result.stderr);
      return { code: result.status, report: JSON.parse(result.stdout) };
    }
  };
}

test("name lint accepts current names and rejects case variants without echoing source contents", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(join(root, "package.json"), '{"name":"octo-runtime-adapter-codex"}');
  assert.equal(run().code, 0);
  await writeFile(
    join(root, "source.ts"),
    `const secret = "DO_NOT_ECHO_${previous.toUpperCase()}";`
  );
  const result = run();
  assert.equal(result.code, 1);
  assert.equal(result.report.findings.length, 1);
  assert.equal(result.report.findings[0].line, 1);
  assert.ok(!JSON.stringify(result.report).includes("DO_NOT_ECHO"));
});

test("name lint works without an rg executable in a non-Git directory", async (t) => {
  const { root, run } = await fixture(t);
  for (const directory of ["node_modules", "dist", ".worktree", "nested/.workbuddy"]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, `${previous}.js`), previous);
  }
  await writeFile(join(root, "secret.md"), previous);
  await writeFile(join(root, "binary.dat"), Buffer.from(`\0${previous}`));
  await writeFile(join(root, ".hidden-source.ts"), previous);
  const result = run({ withoutRg: true });
  assert.equal(result.code, 1);
  assert.deepEqual(
    result.report.findings.map((finding) => finding.file),
    [".hidden-source.ts"]
  );
  await writeFile(join(root, ".hidden-source.ts"), "Octo Runtime");
  assert.equal(run({ withoutRg: true }).code, 0);
});

test("name lint without rg respects Git ignores, negations and excluded paths", async (t) => {
  const { root, run } = await fixture(t);
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "--quiet"]);
  await writeFile(join(root, ".gitignore"), "ignored/\n*.log\n!keep.log\n");
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, "ignored", "source.ts"), previous);
  await writeFile(join(root, "tracked.log"), previous);
  git(["add", "--force", "tracked.log"]);
  await writeFile(join(root, "deleted.ts"), "Octo Runtime");
  git(["add", "deleted.ts"]);
  await rm(join(root, "deleted.ts"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", ".gitignore"), "local.ts\n");
  await writeFile(join(root, "nested", "local.ts"), previous);
  await writeFile(join(root, "nested", "secret.md"), previous);
  await mkdir(join(root, "nested", "dist"));
  await writeFile(join(root, "nested", "dist", "source.ts"), previous);
  await writeFile(join(root, "keep.log"), previous);
  await writeFile(join(root, "source with spaces.ts"), previous);
  const result = run({ withoutRg: true });
  assert.equal(result.code, 1);
  assert.deepEqual(result.report.findings.map((finding) => finding.file).sort(), [
    "keep.log",
    "source with spaces.ts"
  ]);
  await writeFile(join(root, "keep.log"), "Octo Runtime");
  await writeFile(join(root, "source with spaces.ts"), "Octo Runtime");
  assert.equal(run({ withoutRg: true }).code, 0);
});

test("name lint rejects old filenames even when their contents use only new names", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(join(root, `${previous}.md`), "Octo Runtime");
  assert.equal(run().code, 1);
  assert.equal(run().report.findings[0].kind, "path");
});

test("only the exact architecture-review explanation is reported as an exception", async (t) => {
  const { root, run } = await fixture(t);
  await mkdir(join(root, "docs"));
  const file = join(root, "docs/octo-runtime-rename-ipd-se.md");
  const explanation = `架构评审指出：\`${previous}\` 命名有歧义，容易被理解为自研 ReAct 框架。`;
  await writeFile(file, explanation);
  assert.equal(run().code, 0);
  assert.equal(run().report.exceptions.length, 1);
  await writeFile(file, `${explanation}\nimport '${previous}-protocol';`);
  assert.equal(run().code, 1);
  assert.equal(run().report.findings.length, 1);
});

test("name lint does not read dependencies, independent worktrees, credentials or binary contents", async (t) => {
  const { root, run } = await fixture(t);
  for (const directory of ["node_modules", ".worktree"]) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, `${previous}.js`), previous);
  }
  await writeFile(join(root, "secret.md"), previous);
  await writeFile(join(root, "binary.dat"), Buffer.from(`\0${previous}`));
  assert.equal(run().code, 0);
});

const historyFiles = [".gitleaksignore", ".octospec/tasks/gitleaks-history-triage/findings.md"];

test("name lint accepts reviewed historical evidence with LF and CRLF line endings", async (t) => {
  for (const file of historyFiles) {
    const { root, run } = await fixture(t);
    await mkdir(join(root, ".octospec/tasks/gitleaks-history-triage"), { recursive: true });
    const original = await readFile(new URL("../" + file, import.meta.url), "utf8");
    for (const newline of ["\n", "\r\n"]) {
      await writeFile(
        join(root, file),
        original.replaceAll("\r\n", "\n").replaceAll("\n", newline)
      );
      const result = run();
      assert.equal(result.code, 0);
      assert.equal(result.report.findings.length, 0);
      assert.ok(result.report.exceptions.length > 0);
    }
  }
});

test("name lint rejects edits and appended legacy uses in historical evidence", async (t) => {
  for (const file of historyFiles) {
    const { root, run } = await fixture(t);
    await mkdir(join(root, ".octospec/tasks/gitleaks-history-triage"), { recursive: true });
    const original = await readFile(new URL("../" + file, import.meta.url), "utf8");
    for (const changed of [
      original.replace(previous + "-protocol", previous + "-other"),
      original + "\nimport '" + previous + "-protocol';\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(join(root, file), changed);
      const result = run();
      assert.equal(result.code, 1);
      assert.ok(result.report.findings.length > 0);
      assert.equal(result.report.exceptions.length, 0);
    }
  }
});

test("name lint rejects copied history elsewhere and legacy uses beside approved evidence", async (t) => {
  const { root, run } = await fixture(t);
  const original = await readFile(new URL("../.gitleaksignore", import.meta.url), "utf8");
  await writeFile(join(root, ".gitleaksignore"), original);
  await writeFile(join(root, "copied-history.md"), original);
  await writeFile(join(root, "source.ts"), "import '" + previous + "-protocol';");
  await writeFile(join(root, previous + ".md"), "Octo Runtime");
  const result = run();
  assert.equal(result.code, 1);
  assert.ok(result.report.exceptions.length > 0);
  assert.deepEqual(
    [...new Set(result.report.findings.map((finding) => finding.file))].sort(),
    ["copied-history.md", "source.ts", previous + ".md"].sort()
  );
});
