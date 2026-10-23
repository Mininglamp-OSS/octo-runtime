import { execFile, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { createProcessCleanup } from "../packages/octo-runtime-adapter-sdk/dist/process-cleanup.js";

const executeFile = promisify(execFile);

/** 验收脚本拥有本次子进程及其后代；Windows 必须在 leader 存活时回收树。 */
export async function stopReleaseProcess(child, { termGraceMs = 5_500 } = {}) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Release process leader exited before tree cleanup");
    await executeFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      timeout: 5_000,
      windowsHide: true
    });
  } else {
    await createProcessCleanup(child, {
      processGroup: true,
      termGraceMs,
      killGraceMs: 1_000
    })();
  }
}

/** 超时先回收所属树，再报告命令错误；不使用只会终止 leader 的 execFile timeout。 */
export async function runReleaseCommand(file, args, { timeout = 0, label, ...options } = {}) {
  if (label) console.error(`[release] ${label}`);
  const child = spawn(file, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let failure;
  let cleanup;
  let cleanupError;
  let stdout = "";
  let stderr = "";
  const terminate = (error) => {
    if (cleanup) return;
    failure = error;
    cleanup = stopReleaseProcess(child)
      .catch((error) => {
        cleanupError = error;
        child.kill("SIGKILL");
      })
      .finally(() => {
        // 退出的 leader 仍可能留下继承管道的后代；超时结果不能无限等待这些句柄。
        child.stdout.destroy();
        child.stderr.destroy();
      });
  };
  const closed = new Promise((resolveClose) =>
    child.once("close", (code, signal) => resolveClose({ code, signal }))
  );
  child.once("error", (error) => {
    failure = error;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const collect = (previous, chunk) => {
    const value = previous + chunk;
    if (Buffer.byteLength(value) > 1024 * 1024) {
      terminate(new Error("Release command output exceeded 1 MiB"));
      return previous;
    }
    return value;
  };
  child.stdout.on("data", (chunk) => {
    stdout = collect(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = collect(stderr, chunk);
  });
  const timer = timeout
    ? setTimeout(
        () =>
          terminate(new Error(`Release command timed out after ${timeout} ms: ${label ?? file}`)),
        timeout
      )
    : undefined;
  try {
    const { code, signal } = await closed;
    await cleanup;
    if (!failure && (code !== 0 || signal))
      failure = new Error(`Release command failed: ${label ?? file} (${signal ?? code})`);
    if (failure) {
      Object.assign(failure, { code: code ?? failure.code, signal, stdout, stderr });
      if (cleanupError)
        throw new AggregateError(
          [failure, cleanupError],
          "Release command and tree cleanup failed"
        );
      throw failure;
    }
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** 原始验收失败和目录清理失败分别保留；仅为 Windows 已释放句柄的短暂占用做有界重试。 */
export async function withReleaseDirectory(directory, verify, remove = rm) {
  let failed = false;
  let failure;
  try {
    await verify();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await remove(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (failed)
      throw new AggregateError(
        [failure, error],
        "Release verification and directory cleanup failed",
        {
          cause: failure
        }
      );
    throw error;
  }
  if (failed) throw failure;
}
