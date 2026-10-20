import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(new URL("../native/windows-process-owner/", import.meta.url));
const output = fileURLToPath(
  new URL("../packages/octo-runtime-adapter-sdk/dist/native/", import.meta.url)
);
await mkdir(output, { recursive: true });
const toolchain = execFileSync("go", ["version"], { encoding: "utf8" }).trim();
const binaries = {};
for (const architecture of ["amd64", "arm64"]) {
  const name = `windows-process-owner-${architecture}.exe`;
  execFileSync(
    "go",
    [
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-s -w -buildid=",
      "-o",
      join(output, name),
      "."
    ],
    {
      cwd: source,
      env: { ...process.env, CGO_ENABLED: "0", GOOS: "windows", GOARCH: architecture }
    }
  );
  binaries[name] = createHash("sha256")
    .update(await readFile(join(output, name)))
    .digest("hex");
}
await writeFile(
  join(output, "manifest.json"),
  `${JSON.stringify({ toolchain, binaries }, null, 2)}\n`
);
