import net from "node:net";
import { readFile, mkdir, chmod, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RuntimeLogging,
  readBoundedLines,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { extraRegistration, type ExtraDescriptor } from "./extra-config.js";
import { ExtraPlugins, type ExtraPluginModule } from "./extras.js";
import type { ChannelDependencies } from "./context-loader.js";
import { createExtraPort } from "./extra-port.js";
import { attachKernel, acquireEndpoint } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createDependencyProxy } from "./dependencies.js";
import { processChannel } from "./process-channel.js";
import { deadline } from "./launch.js";

interface ExtraConfiguration {
  logging?: RuntimeLoggingOptions;
  declaration: ExtraDescriptor;
  endpoint: string;
  controlEndpoint?: string;
  instance: string;
  epoch: string;
  proxy?: boolean;
  dependencyModule?: { entrypoint: string; exportName: string };
}
const index = process.argv.indexOf("--config");
if (index < 0 || !process.argv[index + 1]) throw new Error("CONFIG_REQUIRED");
const options = JSON.parse(await readFile(process.argv[index + 1], "utf8")) as ExtraConfiguration;
const channel = processChannel(process);
const owner = new AbortController();
const execution = createExtraPort(options.endpoint, owner.signal);
const logs = new RuntimeLogging(options.logging);
const plugins = new ExtraPlugins([extraRegistration(options.declaration)], execution.port, (name) =>
  logs.extra(name)
);
const kernel = attachKernel({ endpoint: options.endpoint });
const inspect = async () => {
  const status =
    options.declaration.enabled === false
      ? { phase: "disabled" }
      : await plugins.inspect(options.declaration.name);
  const available = await kernel.status().then(
    (status) => status.execution_ready,
    () => false
  );
  return { ...status, kernel_available: available };
};
const settings = options.declaration.config.context_loading;
const timeout =
  settings &&
  typeof settings === "object" &&
  !Array.isArray(settings) &&
  typeof settings.timeout_ms === "number"
    ? settings.timeout_ms
    : 5000;
const proxy = options.proxy
  ? createDependencyProxy(channel, options.instance, options.epoch, timeout)
  : undefined;
let server: net.Server | undefined;
let releaseEndpoint: (() => Promise<void>) | undefined;
const connections = new Set<net.Socket>();
let closing: Promise<void> | undefined;
const stop = (requestId?: string): Promise<void> =>
  (closing ??= (async () => {
    owner.abort();
    plugins.stopAdmission();
    proxy?.close();
    for (const socket of connections) socket.destroy();
    const results = await Promise.allSettled([
      deadline(
        execution
          .cancelOwned()
          .finally(() => plugins.close())
          .finally(() => execution.disconnect()),
        4000,
        "EXTRA_RUN_CLEANUP_INCOMPLETE"
      ),
      server ? new Promise<void>((resolve) => server!.close(() => resolve())) : Promise.resolve()
    ]);
    if (releaseEndpoint && options.controlEndpoint && process.platform !== "win32")
      await rm(options.controlEndpoint, { force: true });
    await releaseEndpoint?.();
    kernel.close();
    await logs.close();
    const complete = results.every((result) => result.status === "fulfilled");
    if (process.connected)
      channel.send({ type: "component.stopped", request_id: requestId, complete });
    process.exitCode = complete ? 0 : 1;
    if (process.connected) process.disconnect();
  })());
process.on("message", (message: unknown) => {
  const value = message as { type?: string; request_id?: string };
  if (value.type === "component.stop") void stop(value.request_id);
  if (value.type === "component.status")
    void inspect().then(
      (status) => channel.send({ type: "component.status", request_id: value.request_id, status }),
      () =>
        channel.send({
          type: "component.status",
          request_id: value.request_id,
          status: { phase: "unavailable" }
        })
    );
});
process.once("disconnect", () => {
  proxy?.close();
  void stop();
});
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  let dependencies: ChannelDependencies = proxy ?? {};
  if (options.dependencyModule) {
    if (!isAbsolute(options.dependencyModule.entrypoint) || options.proxy)
      throw new Error("EXTRA_DEPENDENCY_MODULE_INVALID");
    const loaded = (await import(
      pathToFileURL(options.dependencyModule.entrypoint).href
    )) as Record<string, unknown>;
    dependencies = loaded[options.dependencyModule.exportName] as ChannelDependencies;
    if (!dependencies || typeof dependencies !== "object")
      throw new Error("EXTRA_DEPENDENCY_MODULE_INVALID");
  }
  const registration = extraRegistration(options.declaration);
  if (options.declaration.enabled !== false) {
    const module = await registration.load();
    await plugins.load(
      module as ExtraPluginModule<ChannelDependencies>,
      registration.config,
      dependencies
    );
  }
  if (options.controlEndpoint) {
    if (process.platform !== "win32")
      await mkdir(dirname(options.controlEndpoint), { recursive: true, mode: 0o700 });
    releaseEndpoint = await acquireEndpoint(options.controlEndpoint);
    server = net.createServer((socket) => {
      connections.add(socket);
      socket.once("close", () => connections.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.setTimeout(5000, () => socket.destroy());
      const off = readBoundedLines(socket, 4096, {
        onError: () => socket.destroy(),
        onTooLarge: () => socket.destroy(),
        onClose: () => {},
        onLine(line) {
          off();
          try {
            const request = JSON.parse(line) as { id?: string; method?: string };
            if (request.method !== "status") throw new Error("METHOD_NOT_FOUND");
            void inspect().then(
              (status) =>
                socket.end(
                  `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { name: options.declaration.name, pid: process.pid, status } })}\n`
                ),
              () => socket.destroy()
            );
          } catch {
            socket.destroy();
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(options.controlEndpoint, resolve);
    });
    if (process.platform !== "win32") await chmod(options.controlEndpoint, 0o600);
  }
  if (process.connected) channel.send({ type: "component.ready" });
} catch {
  if (process.connected) channel.send({ type: "component.failed", error: "EXTRA_START_FAILED" });
  await stop();
}
