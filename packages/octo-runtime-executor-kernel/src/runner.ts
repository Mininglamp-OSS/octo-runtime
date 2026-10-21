#!/usr/bin/env node
// CLI 内置 worker：显式文件或父进程快照二选一；SDK 自有 worker 直接 import 后调用 serveWorker。
import {
  parseModuleManifest,
  readModuleManifest,
  resolveModuleSpecifier,
  type AdapterModuleEntry
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { serveWorker, type HostedAdapter } from "./index.js";

const index = process.argv.indexOf("--manifest");
const entries = process.argv.includes("--adapters-from-ipc")
  ? await receiveAdapters()
  : index >= 0 && process.argv[index + 1]
    ? (await readModuleManifest(process.argv[index + 1], { legacy: true })).adapters
    : (() => {
        throw new Error("usage: octo-runtime-executor-kernel --manifest <file>");
      })();
const adapters: HostedAdapter[] = [];

for (const entry of entries) {
  const specifier = resolveModuleSpecifier(entry.module, entry.sourceManifest);
  const loaded: unknown = await import(specifier);
  const exports = asRecord(loaded, `adapter module ${entry.module}`);
  const exported = exports[entry.export];
  if (exported === undefined)
    throw new Error(`missing export ${entry.export} from ${entry.module}`);

  // 动态模块先校验工厂与 Adapter 形状，再交给唯一 Core 注册；不提前探测未选模块。
  const instance: unknown = entry.factory ? callFactory(exported, entry) : exported;
  if (!isHostedAdapter(instance))
    throw new TypeError(`${entry.module}#${entry.export} is not an Octo Runtime adapter`);
  if (entry.type && instance.metadata.type !== entry.type)
    throw new Error(`manifest type ${entry.type} does not match adapter ${instance.metadata.type}`);
  adapters.push(instance);
}
serveWorker(adapters);

/** 内部启动消息只携带 JSON 模块声明，不传函数/实例；就绪仍沿用既有 list/probe 握手。 */
function receiveAdapters(): Promise<AdapterModuleEntry[]> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error("Adapter initialization channel disconnected"));
    };
    const onMessage = (message: unknown) => {
      if (!isRecord(message) || message.type !== "kernel.adapters") return;
      cleanup();
      try {
        // 快照已经解析为绝对位置；这个路径只用于结构校验，不读取或生成任何文件。
        resolve(
          parseModuleManifest(
            { version: 1, adapters: message.adapters, extras: [] },
            process.cwd(),
            { legacy: true }
          ).adapters
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid Adapter initialization"));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Adapter initialization timed out"));
    }, 15000);
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
    if (!process.connected) onDisconnect();
  });
}

function callFactory(value: unknown, entry: AdapterModuleEntry): unknown {
  if (typeof value !== "function")
    throw new TypeError(
      `${entry.module}#${entry.export} is marked as a factory but is not callable`
    );
  return (value as (options: Record<string, unknown>) => unknown)(entry.options);
}

function isHostedAdapter(value: unknown): value is HostedAdapter {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  return (
    typeof value.metadata.type === "string" &&
    Array.isArray(value.metadata.agentSources) &&
    value.metadata.agentSources.length > 0 &&
    value.metadata.agentSources.every(
      (source) => source === "preset" || source === "provisioned"
    ) &&
    typeof value.invoke === "function"
  );
}
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
