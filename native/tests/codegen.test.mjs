import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const source = resolve("packages/octo-runtime-protocol/schema");
function generate(output, schema = source, check = false) {
  return spawnSync(
    process.execPath,
    ["native/codegen/generate.mjs", ...(check ? ["--check"] : [])],
    {
      encoding: "utf8",
      env: { ...process.env, OCTO_CODEGEN_OUTPUT: output, OCTO_CODEGEN_SCHEMA: schema }
    }
  );
}
test("generation is reproducible, rejects drift/stale outputs and fails before writing unsupported contracts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "octo-codegen-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, "out");
  let result = generate(output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(generate(output, source, true).status, 0);
  const manifest = JSON.parse(
    await readFile(join(output, "native/generated-manifest.json"), "utf8")
  );
  const before = await Promise.all(manifest.files.map((p) => readFile(join(output, p), "utf8")));
  assert.equal(generate(output).status, 0);
  assert.deepEqual(
    await Promise.all(manifest.files.map((p) => readFile(join(output, p), "utf8"))),
    before
  );
  const first = join(output, manifest.files[0]);
  await writeFile(first, "modified");
  assert.notEqual(generate(output, source, true).status, 0);
  assert.equal(await readFile(first, "utf8"), "modified");
  assert.equal(generate(output).status, 0);
  const stale = join(output, "native/go/generated_retired.go");
  await writeFile(stale, "stale");
  assert.notEqual(generate(output, source, true).status, 0);
  assert.equal(generate(output).status, 0);
  const schema = join(dir, "schema");
  await cp(source, schema, { recursive: true });
  const path = join(schema, "kernel-ipc.schema.json");
  const wire = JSON.parse(await readFile(path, "utf8"));
  wire.definitions.InvokeResult.properties.futureOptional = { type: "boolean" };
  wire["x-octo-methods"].push({
    method: "test.inspect",
    name: "Inspect",
    params: { $ref: "#/definitions/EmptyParams" },
    result: { $ref: "#/definitions/InvokeResult" },
    stream: false,
    sideEffect: false
  });
  await writeFile(path, JSON.stringify(wire));
  assert.equal(generate(output, schema).status, 0);
  for (const file of [
    "native/go/generated_models.go",
    "native/rust/src/generated/models.rs",
    "native/python/src/octo_runtime/generated_models.py"
  ])
    assert.match(await readFile(join(output, file), "utf8"), /futureOptional/);
  for (const file of [
    "native/go/generated_rpc.go",
    "native/rust/src/generated/rpc.rs",
    "native/python/src/octo_runtime/generated_rpc.py"
  ])
    assert.match(await readFile(join(output, file), "utf8"), /test.inspect/);
  const stable = await readFile(join(output, "native/generated-manifest.json"), "utf8");
  wire.definitions.InvokeResult.properties.futureOptional.unsupportedAssertion = true;
  await writeFile(path, JSON.stringify(wire));
  result = generate(output, schema);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported keyword/);
  assert.equal(await readFile(join(output, "native/generated-manifest.json"), "utf8"), stable);
});
