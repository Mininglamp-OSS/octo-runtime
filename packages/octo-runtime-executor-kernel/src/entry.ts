import { readFile } from "node:fs/promises";
import { startKernelServer, type KernelServerOptions } from "./server.js";

const index = process.argv.indexOf("--config");
if (index < 0 || !process.argv[index + 1]) throw new Error("CONFIG_REQUIRED");
const options = JSON.parse(await readFile(process.argv[index + 1], "utf8")) as KernelServerOptions;
try {
  const server = await startKernelServer(options);
  let stopping: Promise<void> | undefined;
  const stop = (requestId?: string) =>
    (stopping ??= (async () => {
      let complete = true;
      try {
        await server.close();
      } catch {
        complete = false;
      }
      if (process.connected)
        process.send?.({ type: "component.stopped", request_id: requestId, complete });
      process.exitCode = complete ? 0 : 1;
      process.disconnect?.();
    })());
  process.on("message", (message: unknown) => {
    const value = message as { type?: string; request_id?: string };
    if (value.type === "component.stop") void stop(value.request_id);
  });
  process.once("disconnect", () => void stop());
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  if (process.connected) process.send?.({ type: "component.ready" });
} catch {
  if (process.connected) process.send?.({ type: "component.failed", error: "KERNEL_START_FAILED" });
  process.exitCode = 1;
  process.disconnect?.();
}
