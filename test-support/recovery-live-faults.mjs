import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import WebSocket from "ws";

/** 只在本验证进程注入测试站鉴权失联和 socket 丢失，不改变系统网络。 */
export function recoveryLiveFaults({ controlFile, eventsFile }) {
  const fetchOriginal = globalThis.fetch;
  const sendOriginal = WebSocket.prototype.send;
  const sockets = new Set();
  let lastDrop = 0;
  const record = (event) =>
    appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), ...event }) + "\n", {
      mode: 0o600
    });
  const control = () => JSON.parse(readFileSync(controlFile, "utf8"));
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
    if (
      parsed.origin === "https://im-test.deepminer.com.cn" &&
      parsed.pathname === "/api/v1/auth/verify-bot" &&
      control().blocked
    ) {
      record({ event: "blocked_auth" });
      throw new TypeError("RECOVERY_QA_LOCAL_NETWORK_FAULT");
    }
    return fetchOriginal(url, init);
  };
  WebSocket.prototype.send = function (...args) {
    if (!sockets.has(this)) {
      sockets.add(this);
      this.once("close", () => sockets.delete(this));
    }
    return sendOriginal.apply(this, args);
  };
  const timer = setInterval(() => {
    const next = control();
    if (next.drop > lastDrop) {
      lastDrop = next.drop;
      record({ event: "drop", sockets: sockets.size });
      for (const socket of sockets) socket.terminate();
    }
  }, 100);
  timer.unref();
  return () => {
    clearInterval(timer);
    globalThis.fetch = fetchOriginal;
    WebSocket.prototype.send = sendOriginal;
  };
}

// 日志 worker 继承 NODE_OPTIONS，但故障只由服务主线程注入和记录。
if (isMainThread && process.env.OCTO_RECOVERY_QA_CONTROL && process.env.OCTO_RECOVERY_QA_EVENTS)
  recoveryLiveFaults({
    controlFile: process.env.OCTO_RECOVERY_QA_CONTROL,
    eventsFile: process.env.OCTO_RECOVERY_QA_EVENTS
  });
