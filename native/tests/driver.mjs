import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
export function command(language) {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (language === "go") return [resolve(".tmp/native-go-driver" + exe), []];
  if (language === "rust") return [resolve("native/rust/target/debug/interop-driver" + exe), []];
  if (language === "python")
    return [
      resolve(
        process.env.OCTO_NATIVE_PYTHON ||
          (process.platform === "win32"
            ? "native/python/.venv/Scripts/python.exe"
            : "native/python/.venv/bin/python")
      ),
      [resolve("native/python/tests/interop_driver.py")]
    ];
  throw Error("Unknown language " + language);
}
export function build(language) {
  if (language === "python") return;
  const [tool, args, cwd] =
    language === "go"
      ? ["go", ["build", "-race", "-o", command(language)[0], "./cmd/interop-driver"], "native/go"]
      : ["cargo", ["build", "--locked", "--bin", "interop-driver"], "native/rust"];
  const p = spawnSync(tool, args, { cwd: resolve(cwd), encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
}
export async function batch(language, commands) {
  return new Promise((yes, no) => {
    const [exe, args] = command(language);
    const p = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      p.kill();
      no(Error("driver timeout " + stderr));
    }, 60000);
    p.stdout.on("data", (c) => (stdout += c));
    p.stderr.on("data", (c) => (stderr += c));
    p.once("error", (e) => {
      clearTimeout(timer);
      no(e);
    });
    p.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return no(Error(stderr || `exit ${code}`));
      try {
        const out = stdout.trim().split("\n").map(JSON.parse);
        assert.equal(out.length, commands.length, stderr);
        yes(out);
      } catch (e) {
        no(Error(stderr + e));
      }
    });
    p.stdin.end(commands.map((c) => JSON.stringify(c)).join("\n") + "\n");
  });
}
export async function call(language, command) {
  return (await batch(language, [command]))[0];
}
