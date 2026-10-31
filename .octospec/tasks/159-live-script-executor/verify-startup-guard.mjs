import childProcess from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import { registerHooks, syncBuiltinESMExports } from "node:module";

// 仅由手动 runner 预加载到被测进程；连同被捕获的异常也留下标记，父进程据此判失败。
function deny(operation) {
  return function () {
    const message = `QA_STARTUP_SIDE_EFFECT:${operation}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    throw new Error(message);
  };
}

for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
  childProcess[name] = deny(`child_process.${name}`);
net.connect = deny("net.connect");
net.createConnection = deny("net.createConnection");
net.Socket.prototype.connect = deny("Socket.connect");
tls.connect = deny("tls.connect");
for (const [name, module] of [
  ["http", http],
  ["https", https]
]) {
  module.request = deny(`${name}.request`);
  module.get = deny(`${name}.get`);
}
http2.connect = deny("http2.connect");
dgram.createSocket = deny("dgram.createSocket");
globalThis.fetch = deny("fetch");
globalThis.WebSocket = deny("WebSocket");
syncBuiltinESMExports();

// 只在指定的实际脚本上恢复旧导入，验证同一离线入口会检出原缺陷；不修改磁盘文件。
const removedExportScript = process.env.OCTO_QA_REMOVED_EXPORT_SCRIPT;
if (removedExportScript) {
  const target = new URL(`../../../scripts/${removedExportScript}`, import.meta.url).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL === target &&
        specifier === "../packages/octo-runtime-executor-core/dist/index.js"
      ) {
        return nextResolve("../packages/octo-runtime-executor-kernel/dist/index.js", context);
      }
      return nextResolve(specifier, context);
    }
  });
}
