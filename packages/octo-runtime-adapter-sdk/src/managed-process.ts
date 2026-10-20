import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions
} from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Duplex } from "node:stream";

interface Identity {
  pid: number;
  started?: string;
}
interface WindowsOwner {
  identity: Promise<Identity>;
  current?: Identity;
  clear(): Promise<void>;
}
const owners = new WeakMap<ChildProcess, WindowsOwner>();
let executable: string | undefined;

function ownerExecutable(): string {
  if (executable) return executable;
  const architecture = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (!architecture) throw new Error("WINDOWS_PROCESS_ARCH_UNSUPPORTED");
  const name = `windows-process-owner-${architecture}.exe`;
  const file = new URL(`./native/${name}`, import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("./native/manifest.json", import.meta.url), "utf8")
  ) as {
    binaries: Record<string, string>;
  };
  if (createHash("sha256").update(readFileSync(file)).digest("hex") !== manifest.binaries[name])
    throw new Error("WINDOWS_PROCESS_RESOURCE_INVALID");
  return (executable = fileURLToPath(file));
}

/** 私有平台实现：数据通道直通目标；ChildProcess 始终代表实际 spawn 的 broker，不伪造 PID。 */
export function spawnManaged(
  command: string,
  args: readonly string[],
  options: SpawnOptions & { stdio: ["pipe", "pipe", "pipe"] | ["pipe", "pipe", "pipe", "ipc"] },
  ownerGraceMs?: number
): ChildProcessWithoutNullStreams;
export function spawnManaged(
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
  ownerGraceMs?: number
): ChildProcess;
export function spawnManaged(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
  ownerGraceMs = 0
): ChildProcess {
  if (process.platform !== "win32") return spawn(command, args, options);
  if (options.shell) throw new Error("WINDOWS_MANAGED_SHELL_UNSUPPORTED");
  const original = options.stdio ?? "pipe";
  const stdio = Array.isArray(original) ? [...original] : [original, original, original];
  if (stdio.length > 4) throw new Error("WINDOWS_MANAGED_STDIO_UNSUPPORTED");
  while (stdio.length < 4) stdio.push("ignore");
  stdio.push("overlapped");
  const child = spawn(ownerExecutable(), [], {
    ...options,
    stdio,
    detached: true,
    windowsHide: true
  });
  const control = child.stdio[4] as Duplex;
  let resolveIdentity!: (identity: Identity) => void;
  let rejectIdentity!: (error: Error) => void;
  const identity = new Promise<Identity>((resolve, reject) => {
    resolveIdentity = resolve;
    rejectIdentity = reject;
  });
  void identity.catch(() => undefined);
  let resolveCleared!: () => void;
  let rejectCleared!: (error: Error) => void;
  const cleared = new Promise<void>((resolve, reject) => {
    resolveCleared = resolve;
    rejectCleared = reject;
  });
  void cleared.catch(() => undefined);
  let cleanup: Promise<void> | undefined;
  const owner: WindowsOwner = {
    identity,
    clear: () =>
      (cleanup ??= (async () => {
        if (!child.pid) return;
        if (child.exitCode === null && child.signalCode === null) send({ type: "stop" });
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            cleared,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("PROCESS_TREE_CLEANUP_INCOMPLETE")), 5500);
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
      })())
  };
  owners.set(child, owner);
  const fail = (error: Error) => {
    rejectIdentity(error);
    rejectCleared(error);
  };
  const send = (value: object) => {
    if (!control?.destroyed) control.write(`${JSON.stringify(value)}\n`);
  };
  let buffer = "";
  control?.setEncoding("utf8");
  control?.on("error", () => fail(new Error("WINDOWS_PROCESS_CONTROL_LOST")));
  control?.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 4096) {
      fail(new Error("WINDOWS_PROCESS_CONTROL_INVALID"));
      control.destroy();
      return;
    }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const frame = JSON.parse(line) as {
          type: string;
          nonce?: string;
          pid?: number;
          started?: string;
        };
        if (frame.type === "challenge" && typeof frame.nonce === "string")
          send({ type: "owner", nonce: frame.nonce });
        else if (frame.type === "started" && Number.isSafeInteger(frame.pid) && frame.pid! > 0) {
          owner.current = { pid: frame.pid!, started: frame.started };
          resolveIdentity(owner.current);
          send({ type: "resume" });
        } else if (frame.type === "cleared") resolveCleared();
        else fail(new Error("WINDOWS_PROCESS_START_FAILED"));
      } catch {
        fail(new Error("WINDOWS_PROCESS_CONTROL_INVALID"));
        control.destroy();
      }
    }
  });
  child.once("error", fail);
  child.once("close", () => {
    rejectIdentity(new Error("WINDOWS_PROCESS_START_FAILED"));
    rejectCleared(new Error("PROCESS_TREE_CLEANUP_INCOMPLETE"));
  });
  send({
    type: "launch",
    command,
    args,
    argv0: options.argv0,
    owner: process.pid,
    grace_ms: ownerGraceMs
  });
  const timer = setTimeout(() => {
    fail(new Error("WINDOWS_PROCESS_START_TIMEOUT"));
    control.destroy();
  }, 5000);
  void identity.finally(() => clearTimeout(timer)).catch(() => undefined);
  return child;
}

export function managedIdentity(child: ChildProcess): Promise<Identity> {
  const owner = owners.get(child);
  if (owner) return owner.identity;
  return child.pid === undefined
    ? Promise.reject(new Error("PROCESS_NOT_STARTED"))
    : Promise.resolve({ pid: child.pid });
}

export function managedTargetPid(child: ChildProcess): number | undefined {
  return owners.get(child)?.current?.pid ?? child.pid;
}

export function managedCleanup(child: ChildProcess): (() => Promise<void>) | undefined {
  const owner = owners.get(child);
  return owner ? () => owner.clear() : undefined;
}
