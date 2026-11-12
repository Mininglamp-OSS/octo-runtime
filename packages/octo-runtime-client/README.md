# @mininglamp-oss/octo-runtime-client

Standalone Node.js SDK for an existing local Executor Kernel. Requires Node.js 24 or 26. The host supplies the endpoint; this package manages client connections and invocations.

```sh
npm install @mininglamp-oss/octo-runtime-client
```

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime-client/protocol";

// The host supplies an existing Unix socket or Windows named pipe endpoint.
async function execute(endpoint: string, input: InvokeInput) {
  const client = attachKernel({ endpoint });
  try {
    const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
    for await (const event of client.invoke(
      { ...content, parts, protocol_mode: "canonical" },
      sessionId,
      providerSession,
      agentEnv
    )) {
      console.log(event);
    }
  } finally {
    // Close releases this client's connections; it does not stop the Kernel or cancel runs.
    client.close();
  }
}
```

Observe the terminal result and handle stream errors. Cancel unwanted executions explicitly with interrupt; closing a client releases connections without cancelling accepted runs or stopping Kernel.

## Reference

- [SDK integration](../../docs/en/getting-started/sdk.md) and [KernelClient methods](../../docs/en/reference/kernel-client.md).
- [Inputs](../../docs/en/reference/input-parts.md), [Invoke API / ProviderSession](../../docs/en/reference/invoke-input.md), [AgentEnv](../../docs/en/reference/agent-env-standard.md) and [Adapter settings](../../docs/en/reference/agent-env/private-items.md).
- [Output / interactions](../../docs/en/reference/output-and-control.md) and [IPC / schemas](../../docs/en/reference/kernel-ipc.md).

The root exports client APIs. /protocol provides shared public types and validators, /protocol/schema.json and /protocol/ipc-schema.json provide Draft-07 schemas, and /protocol/ipc-fixtures.json provides conformance samples. The private protocol package is bundled with this distribution.

## 中文

本包连接宿主提供的本地 Kernel，维护自己的连接和调用。读取终态并处理流异常；取消执行使用 interrupt，close 仅释放客户端连接。

详细定义见 [SDK 接入](../../docs/zh-CN/getting-started/sdk.md)、[KernelClient](../../docs/zh-CN/reference/kernel-client.md)、[Inputs](../../docs/zh-CN/reference/input-parts.md)、[Invoke API](../../docs/zh-CN/reference/invoke-input.md)、[AgentEnv](../../docs/zh-CN/reference/agent-env-standard.md)、[Adapter 私有字段](../../docs/zh-CN/reference/agent-env/private-items.md)、[输出与交互](../../docs/zh-CN/reference/output-and-control.md)和 [IPC](../../docs/zh-CN/reference/kernel-ipc.md)。
