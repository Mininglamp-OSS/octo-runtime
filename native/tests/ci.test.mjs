import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("CI Gate rejects native failures, cancellations and skipped jobs", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /needs: \[check, verify-windows-release, native-generated, native\]/);
  const gate = workflow.slice(workflow.lastIndexOf("  gate:"));
  const command = gate
    .slice(gate.lastIndexOf("        run: |\n") + "        run: |\n".length)
    .split("\n")
    .map((x) => x.replace(/^          /, ""))
    .join("\n");
  const names = [
    "CHECK_RESULT",
    "WINDOWS_RELEASE_RESULT",
    "NATIVE_GENERATED_RESULT",
    "NATIVE_RESULT"
  ];
  const passed = Object.fromEntries(names.map((x) => [x, "success"]));
  function run(overrides) {
    return spawnSync("bash", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, ...passed, ...overrides }
    });
  }
  assert.equal(run({}).status, 0);
  for (const name of names)
    for (const value of ["failure", "cancelled", "skipped", ""]) {
      const result = run({ [name]: value });
      assert.equal(result.status, 1, `${name}=${value}: ${result.stderr}`);
    }
});
