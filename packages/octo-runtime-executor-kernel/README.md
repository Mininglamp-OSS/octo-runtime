# Executor Kernel

[简体中文](README.zh.md) | [Packages](../README.md)

Kernel manages AgentExecutor, registered Adapters, local RPC and bounded execution output within its host process. Native hosts depend on this source-workspace package; standalone applications install [runtime-client](../octo-runtime-client/README.md) to connect to an existing Kernel.

## Minimal Usage

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

The host prepares Home and constructs the Adapters passed to createKernelService. Wait for initialize before using kernel.client. Close owned services on exit and inspect complete. Passing a shared dependency does not transfer ownership to Kernel.

Kernel and Adapters share their host's failure domain. Local RPC provides neither crash nor memory isolation. The references below define invocation identity, cancellation, observation recovery and stream capacity.

## Developer Reference

- [SDK Integration](../../docs/en/getting-started/sdk.md), [KernelClient](../../docs/en/reference/kernel-client.md), [Runtime Home](../../docs/en/reference/runtime-home.md).
- [Invoke API](../../docs/en/reference/invoke-input.md), [Inputs](../../docs/en/reference/input-parts.md), [AgentEnv Standard Reference](../../docs/en/reference/agent-env-standard.md).
- [Kernel IPC](../../docs/en/reference/kernel-ipc.md), [Output and Interactions](../../docs/en/reference/output-and-control.md), [Startup Diagnostics](../../docs/en/guides/startup-diagnostics.md).

Implementation: [service](src/service.ts), [RPC](src/server.ts), [output window](src/host-run-service.ts). Tests: [native composition](../../test/adapter-composition.test.js), [shutdown](../../test/host-process-close.test.js).
