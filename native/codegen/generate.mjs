import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { normalize } from "./normalize.mjs";
import { emitGo } from "./emit-go.mjs";
import { emitPython } from "./emit-python.mjs";
import { emitRust } from "./emit-rust.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schema = process.env.OCTO_CODEGEN_SCHEMA
  ? pathToFileURL(resolve(process.env.OCTO_CODEGEN_SCHEMA) + "/")
  : new URL("../../packages/octo-runtime-protocol/schema/", import.meta.url);
const ir = await normalize(schema);
const outputRoot = process.env.OCTO_CODEGEN_OUTPUT
  ? resolve(process.env.OCTO_CODEGEN_OUTPUT)
  : root;
const outputs = { ...emitGo(ir), ...emitPython(ir), ...emitRust(ir) };
const digest = (data) => createHash("sha256").update(data).digest("hex");
const generatorHash = createHash("sha256");
async function hashTree(dir) {
  for (const entry of (await readdir(resolve(root, dir), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) await hashTree(path);
    else generatorHash.update(path + "\0" + (await readFile(resolve(root, path), "utf8")));
  }
}
await hashTree("native/codegen");
const sourceHash = createHash("sha256");
for (const [name, text] of ir.sources) sourceHash.update(name + "\0" + text);
const manifest = {
  revision: 2,
  sourceHash: sourceHash.digest("hex"),
  generatorHash: generatorHash.digest("hex"),
  files: Object.keys(outputs).sort()
};
let previous;
try {
  previous = JSON.parse(
    await readFile(resolve(outputRoot, "native/generated-manifest.json"), "utf8")
  );
} catch {}
async function findStale(dir) {
  let entries;
  try {
    entries = await readdir(resolve(outputRoot, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) {
      if (!["target", ".venv", "__pycache__"].includes(entry.name))
        found.push(...(await findStale(path)));
    } else if (
      (entry.name.startsWith("generated_") || dir === "native/rust/src/generated") &&
      path !== "native/generated-manifest.json" &&
      !Object.hasOwn(outputs, path)
    )
      found.push(path);
  }
  return found;
}
const stale = [
  ...new Set([
    ...(previous?.files ?? []).filter((p) => !(p in outputs)),
    ...(await findStale("native"))
  ])
];
if (stale.some((p) => !p.startsWith("native/") || p.includes("..")))
  throw Error("Unsafe generated manifest path");

if (process.argv.includes("--check")) {
  // 摘要同时覆盖 Schema、生成器、输出清单和各产物字节；检查不调用语言工具链。
  const drift = [...stale];
  if (
    Object.entries(manifest).some(
      ([key, value]) => JSON.stringify(previous?.[key]) !== JSON.stringify(value)
    )
  )
    drift.push("native/generated-manifest.json");
  for (const path of manifest.files) {
    let actual;
    try {
      actual = digest(await readFile(resolve(outputRoot, path)));
    } catch {}
    if (!actual || actual !== previous?.fileHashes?.[path]) drift.push(path);
  }
  if (drift.length)
    throw Error("Generated drift; run node native/codegen/generate.mjs:\n" + drift.join("\n"));
  console.log("Generated inputs and file hashes match (" + (manifest.files.length + 1) + ")");
} else {
  const temp = await mkdtemp(resolve(tmpdir(), "octo-gen-"));
  try {
    for (const [path, data] of Object.entries(outputs)) {
      const target = resolve(temp, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    for (const [tool, ext, args, install] of [
      ["gofmt", ".go", ["-w"], "Install Go 1.25+ and add gofmt to PATH."],
      [
        "rustfmt",
        ".rs",
        ["--edition", "2021"],
        "Run rustup component add rustfmt and add it to PATH."
      ]
    ]) {
      const files = manifest.files.filter((p) => p.endsWith(ext)).map((p) => resolve(temp, p));
      if (!files.length) continue;
      const result = spawnSync(tool, [...args, ...files], { encoding: "utf8" });
      if (result.error?.code === "ENOENT")
        throw Error(tool + " is required to regenerate native sources. " + install);
      if (result.status !== 0) throw Error(result.stderr || tool + " failed");
    }
    for (const path of manifest.files) outputs[path] = await readFile(resolve(temp, path), "utf8");
    manifest.fileHashes = Object.fromEntries(
      manifest.files.map((path) => [path, digest(outputs[path])])
    );
    outputs["native/generated-manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
    for (const path of stale) await rm(resolve(outputRoot, path));
    for (const [path, data] of Object.entries(outputs)) {
      await mkdir(dirname(resolve(outputRoot, path)), { recursive: true });
      await writeFile(resolve(outputRoot, path), data);
    }
    console.log("Generated " + Object.keys(outputs).length + " files");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
