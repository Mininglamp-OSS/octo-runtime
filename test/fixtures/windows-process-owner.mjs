import { spawn } from "node:child_process";
import {
  spawnManaged,
  managedIdentity
} from "../../packages/octo-runtime-adapter-sdk/dist/managed-process.js";

if (["owner", "blocked-owner"].includes(process.argv[2])) {
  const child = spawnManaged(
    process.execPath,
    [import.meta.filename, process.argv[2] === "blocked-owner" ? "blocked-target" : "target"],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    },
    4500
  );
  const identity = await managedIdentity(child);
  child.once("message", (value) =>
    process.send?.({ ...value, broker: child.pid, target: identity.pid })
  );
  process.on("message", () => process.exit(0));
} else {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  process.on("message", (message) => {
    if (message === "exit") process.exit(0);
    else process.send?.({ echo: message });
  });
  process.once("disconnect", () => process.exit(0));
  process.send?.(
    {
      pid: process.pid,
      descendant: child.pid,
      args: process.argv.slice(3),
      cwd: process.cwd(),
      env: process.env.OCTO_TEST_OWNER
    },
    () => {
      if (process.argv[2] === "blocked-target") {
        while (true) {
          /* 模拟无法调度 disconnect/dispose 的同步阻塞插件。 */
        }
      }
    }
  );
}
