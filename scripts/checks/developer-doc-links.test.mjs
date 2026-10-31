import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { auditDocumentLinks, isCurrentDocument } from "../lib/developer-doc-links.mjs";

const repository = resolve(import.meta.dirname, "../..");

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "ort-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

test("GitHub headings cover Unicode, formatting, Setext and duplicate collisions", async (t) => {
  const root = await fixture(t, {
    "README.md": [
      "# 中文 *标题* `API` [链接](https://example.com)",
      "# Hello! World?",
      "# Hello! World?",
      "# Hello World-1",
      "# Hello! World?",
      "Setext Title",
      "---",
      "",
      "[中文](#%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98-api-%E9%93%BE%E6%8E%A5)",
      "[one](#hello-world) [two](#hello-world-1) [collision](#hello-world-1-1)",
      "[three](#hello-world-2) [setext](#setext-title)"
    ].join("\n")
  });
  assert.deepEqual((await auditDocumentLinks(root, ["README.md"])).errors, []);
});

test("relative encoded paths, reference definitions and HTML anchors resolve", async (t) => {
  const root = await fixture(t, {
    "README.md":
      "[one][DOC]\n\n[DOC]: <docs/带 空格.md#exact-ID>\n\n[two](docs/带%20空格.md#legacy)\n\n![image](asset.png#opaque)\n\n[dir](docs/#opaque)",
    "docs/带 空格.md": '<a ID="exact-ID"></a>\n\n<a name=legacy></a>',
    "asset.png": "fixture"
  });
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 4);
  assert.equal(result.fragments, 4);
});

test("first reference definition wins and anchors are not arbitrary body strings", async (t) => {
  const root = await fixture(t, {
    "README.md":
      "[valid][ref]\n\n[ref]: #real\n[ref]: missing.md\n\n# Real\n\nbody-only\n\n[invalid](#body-only)"
  });
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /missing Markdown anchor/);
});

test("aggregates missing files, missing anchors, malformed escapes and undefined references", async (t) => {
  const root = await fixture(t, {
    "README.md":
      "# Root\n\n[file](missing.md)\n[anchor](#unknown)\n[encoding](%ZZ.md)\n[fragment](#%ZZ)\n[undefined][ref]\n[collapsed][]"
  });
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.equal(result.errors.length, 6);
  assert.deepEqual(
    result.errors.map((error) => error.line),
    [3, 4, 5, 6, 7, 8]
  );
  assert.match(result.errors[4].reason, /unresolved/);
});

test("undefined references may follow prose or contain formatted and nested labels", async (t) => {
  const root = await fixture(t, {
    "README.md":
      "word[bad][missing]\n\n[**bad**][missing]\n\n[outer [inner]][missing]\n\n😀[with `code`][]\n\n![image *label*][missing]"
  });
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.equal(result.errors.length, 5);
  assert.deepEqual(
    result.errors.map((error) => error.line),
    [1, 3, 5, 7, 9]
  );
  assert.ok(result.errors.every((error) => error.reason.includes("unresolved")));
});

test("ignores code, escaped reference prose and external URLs without requesting them", async (t) => {
  const root = await fixture(t, {
    "README.md":
      "```md\n[broken](missing.md)\n```\n\n`[inline][missing]`\n\n\\[escaped][missing]\n\n[external](https://127.0.0.1:1/no-request)\n[mail](mailto:example@example.com)\n[relative](//example.com/remote)"
  });
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 3);
  assert.equal(result.skipped, 3);
});

test("repository bounds reject sibling-prefix paths and symlink escapes", async (t) => {
  const root = await fixture(t, { "README.md": "[escape](../outside.md)\n[link](escape.md)" });
  await writeFile(
    join(root, "README.md"),
    `[escape](../${basename(root)}-neighbor.md)\n[link](escape.md)`
  );
  const outside = await fixture(t, { "secret.md": "# Secret" });
  await symlink(join(outside, "secret.md"), join(root, "escape.md"));
  const result = await auditDocumentLinks(root, ["README.md"]);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].reason, /outside repository/);
  assert.match(result.errors[1].reason, /symlink outside/);
});

test("historical targets are checked but their outbound links are not scanned", async (t) => {
  const root = await fixture(t, {
    "README.md": "[history](.octospec/journal/old.md#evidence)",
    ".octospec/journal/old.md": "# Evidence\n\n[old](removed.md)"
  });
  assert.deepEqual((await auditDocumentLinks(root, ["README.md"])).errors, []);
  await writeFile(join(root, "README.md"), "[history](.octospec/journal/old.md#wrong)");
  assert.equal((await auditDocumentLinks(root, ["README.md"])).errors.length, 1);
});

test("current scope includes root, packages and knowledge entries but excludes history/generated files", () => {
  for (const name of [
    "README.md",
    "apps/README.md",
    "packages/core/README.md",
    "docs/en/sdk.md",
    ".octospec/index.md",
    ".octospec/rules/architecture.md",
    ".octospec/guides/workspace.md"
  ])
    assert.equal(isCurrentDocument(name), true, name);
  for (const name of [
    ".octospec/tasks/old/brief.md",
    ".octospec/journal/old.md",
    "scripts/README.md",
    "packages/core/vendor/README.md",
    "apps/cli/dist/README.md",
    "docs/node_modules/lib/README.md",
    "README.txt"
  ])
    assert.equal(isCurrentDocument(name), false, name);
});

test("empty source lists and unreadable targets fail instead of reporting success", async (t) => {
  const root = await fixture(t, { "README.md": "[missing](gone.md)" });
  assert.match((await auditDocumentLinks(root, [])).errors[0].reason, /no source/);
  assert.equal((await auditDocumentLinks(root, ["gone.md"])).errors.length, 1);
});

test("CLI explicitly selects tracked current docs without a Runtime build and reports exit codes", async (t) => {
  const root = await fixture(t, {
    "README.md": "# Root\n\n[ok](#root)",
    "docs/en/guide.md": "# Guide",
    ".octospec/journal/old.md": "[old](missing.md)",
    "untracked.md": "[bad](missing.md)"
  });
  await mkdir(join(root, "scripts/lib"), { recursive: true });
  for (const file of ["scripts/check-developer-docs.mjs", "scripts/lib/developer-doc-links.mjs"])
    await copyFile(join(repository, file), join(root, file));
  await mkdir(join(root, "node_modules"));
  for (const dependency of ["prettier", "ajv", "github-slugger", "parse5"])
    await symlink(
      join(repository, "node_modules", dependency),
      join(root, "node_modules", dependency),
      "dir"
    );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "README.md", "docs", ".octospec"], { cwd: root });
  const run = (args) =>
    spawnSync(process.execPath, [join(root, "scripts/check-developer-docs.mjs"), ...args], {
      encoding: "utf8"
    });
  const passed = run(["--scope", "current"]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /2 documents/);
  await writeFile(join(root, "README.md"), "[broken](#unknown)");
  const failed = run(["--scope", "current"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /README.md:1: #unknown/);
  for (const args of [["--scope"], ["--scope", "all"], ["--other"], ["--scope current"]])
    assert.equal(run(args).status, 2);
  // 默认入口仍进入原有 docs 校验，而不是扩展扫描；此夹具未提供原有 schema。
  const original = run([]);
  assert.notEqual(original.status, 0);
  assert.doesNotMatch(original.stdout, /Current docs:/);
  assert.match(original.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(
    await readFile(join(repository, "package.json"), "utf8"),
    /node --test docs\/checks\/\*\.test\.mjs/
  );
});
