# Executor Kernel

[English](README.md) | [包导航](../README.zh.md)

Kernel 在宿主进程中管理 AgentExecutor、注册的 Adapter、本地 RPC 和有界执行输出。原生宿主从源码 workspace 依赖本包；独立应用安装 [runtime-client](../octo-runtime-client/README.md) 连接已有 Kernel。

## 最小用法

```ts
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";

import { mkdir } from "node:fs/promises";

// 宿主拥有目录选择和根准备。
const home = "/absolute/app-runtime-home";
await mkdir(home, { recursive: true });
const kernel = createKernelService({
  home,
  endpoint: componentEndpoint(home),
  adapters: [dshAdapter],
  adapterConfigurations: { dsh: { providerOptions: { dshBin: "/absolute/dsh/lib/bin.js" } } }
});
await kernel.initialize();
// 使用 kernel.client.invoke，消费到终态；退出先排空 business consumer 和业务尾流，再关闭服务。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

宿主选择并准备 Home，构造所需 Adapter 后传给 createKernelService，等待 initialize 完成后使用 kernel.client。退出时关闭自有服务并检查 complete。共享依赖不因传入 Kernel 而转移所有权。

Kernel 与 Adapter 共用宿主进程的故障域。本地 RPC 不提供崩溃或内存隔离。调用身份、取消、观察恢复和流容量定义集中在下列参考。

## 开发参考

- [SDK 接入](../../docs/zh-CN/getting-started/sdk.md)、[KernelClient](../../docs/zh-CN/reference/kernel-client.md)、[Runtime Home](../../docs/zh-CN/reference/runtime-home.md)。
- [Invoke API](../../docs/zh-CN/reference/invoke-input.md)、[Inputs](../../docs/zh-CN/reference/input-parts.md)、[AgentEnv 标准参考](../../docs/zh-CN/reference/agent-env-standard.md)。
- [Kernel IPC](../../docs/zh-CN/reference/kernel-ipc.md)、[输出与交互](../../docs/zh-CN/reference/output-and-control.md)、[启动诊断](../../docs/zh-CN/guides/startup-diagnostics.md)。

实现：[服务](src/service.ts)、[RPC](src/server.ts)、[输出窗口](src/host-run-service.ts)。测试：[原生对象装配](../../test/adapter-composition.test.js)、[关闭](../../test/host-process-close.test.js)。
