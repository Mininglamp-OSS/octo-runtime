import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

/** 手动验收读取宿主指定的 QA 文件；校验与有界读取绑定同一描述符。 */
export async function readQaAccounts(file) {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || (process.platform !== "win32" && info.mode & 0o077))
      throw new Error("MIMO_QA_FILE_PERMISSIONS_INVALID");
    if (!constants.O_NOFOLLOW) {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.dev !== info.dev || entry.ino !== info.ino)
        throw new Error("MIMO_QA_FILE_PERMISSIONS_INVALID");
    }
    const maximum = 1024 * 1024;
    if (info.size > maximum) throw new Error("MIMO_QA_FILE_TOO_LARGE");
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new Error("MIMO_QA_FILE_TOO_LARGE");
    return bytes
      .subarray(0, length)
      .toString("utf8")
      .split(/(?=Bot Name:)/)
      .filter((block) => block.startsWith("Bot Name:"))
      .map((block) => {
        const field = (name) => block.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
        return { id: field("Bot ID"), token: field("Bot Token"), api: field("API Server") };
      })
      .filter((account) => account.token?.startsWith("bf_"));
  } finally {
    await handle.close();
  }
}

/** 组件先自行关闭后代；强杀也必须有独立的退出确认期限，不能作为验收成功。 */
export async function stopCliComponent(
  child,
  {
    termGraceMs = 8000,
    killGraceMs = 1000,
    gracefulSignal = "SIGTERM",
    allowedExitCodes = [0]
  } = {}
) {
  if (!child) return;
  const assertCleanExit = (code, signal) => {
    if (!allowedExitCodes.includes(code) || signal)
      throw Object.assign(new Error("MIMO_COMPONENT_CLEANUP_FAILED"), {
        pid: child.pid,
        exitCode: code,
        signal
      });
  };
  if (child.exitCode !== null || child.signalCode !== null) {
    assertCleanExit(child.exitCode, child.signalCode);
    return;
  }
  let onClose;
  const closed = new Promise((resolve) => {
    onClose = (code, signal) => resolve({ code, signal });
    child.once("close", onClose);
  });
  const failures = [];
  const onError = (error) => failures.push(error);
  child.on("error", onError);
  const sendSignal = (name) => {
    try {
      if (!child.kill(name)) failures.push(new Error("MIMO_COMPONENT_SIGNAL_NOT_DELIVERED"));
    } catch (error) {
      failures.push(error);
    }
  };
  const confirm = async (timeout) => {
    let timer;
    try {
      return await Promise.race([
        closed,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeout);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    sendSignal(gracefulSignal);
    let result = await confirm(termGraceMs);
    if (!result) {
      sendSignal("SIGKILL");
      result = await confirm(killGraceMs);
    }
    if (!result) {
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      throw Object.assign(new AggregateError(failures, "MIMO_COMPONENT_CLEANUP_INCOMPLETE"), {
        cleanupComplete: false,
        pid: child.pid
      });
    }
    assertCleanExit(result.code, result.signal);
  } finally {
    child.removeListener("close", onClose);
    child.removeListener("error", onError);
  }
}

/** 验收拥有所有清理步骤；独立尝试每项并保留原始失败，调用方据此保留未释放的 Home。 */
export async function withVerificationCleanup(run, steps) {
  const failures = [];
  let value;
  try {
    value = await run();
  } catch (error) {
    failures.push(error);
  }
  const cleanupFailures = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length)
    throw Object.assign(
      new AggregateError([...failures, ...cleanupFailures], "MIMO_VERIFICATION_CLEANUP_FAILED"),
      { cleanupComplete: false }
    );
  if (failures.length) throw failures[0];
  return value;
}

/** 仅展示本次拥有的 PID 和数字退出状态；错误正文及 cause 不进入验收日志。 */
export function verificationFailure(error) {
  const processes = [];
  const seen = new Set();
  const visit = (failure) => {
    if (!failure || seen.has(failure)) return;
    seen.add(failure);
    if (Number.isSafeInteger(failure.pid) && failure.pid > 0)
      processes.push({
        pid: failure.pid,
        ...(Number.isInteger(failure.exitCode) ? { exitCode: failure.exitCode } : {})
      });
    if (failure instanceof AggregateError) failure.errors.forEach(visit);
  };
  visit(error);
  return { cleanupComplete: error?.cleanupComplete !== false, processes };
}
