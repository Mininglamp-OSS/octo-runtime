#!/usr/bin/env node
import { runCli } from "./main.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // 仅可执行入口拥有进程退出权；给输出刷新留出预算，残留句柄不能无限阻止退出。
  // unref 让资源已回收的 CLI 自然退出，SDK 和可导入的 runCli 不终止调用进程。
  setTimeout(() => process.exit(), 250).unref();
}
