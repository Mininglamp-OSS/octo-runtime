# Runtime 公共协议

[English](README.md) | [包导航](../README.zh.md)

本包维护输入、AgentEnv、输出事件和 IPC 的 Schema、TypeScript 类型及运行时校验器。它是 private workspace 包，供 Runtime 与源码宿主使用；独立应用从 `@mininglamp-oss/octo-runtime-client/protocol` 导入公开协议。

## 最小用法

```ts
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});
```

InvokeInput.check 校验结构与容量，失败时抛错，不执行调用。Adapter 负责所消费配置的语义校验。

## 开发参考

| 主题 | 权威说明 |
| --- | --- |
| 文本、图片与恢复输入 | [Inputs](../../docs/zh-CN/reference/input-parts.md) |
| 调用参数与 ProviderSession | [Invoke API](../../docs/zh-CN/reference/invoke-input.md) |
| 七个标准执行项 | [AgentEnv 标准参考](../../docs/zh-CN/reference/agent-env-standard.md) |
| 帧、事件与交互 payload | [输出与控制](../../docs/zh-CN/reference/output-and-control.md) |
| SDK 方法与 IPC | [KernelClient](../../docs/zh-CN/reference/kernel-client.md)、[Kernel IPC](../../docs/zh-CN/reference/kernel-ipc.md) |

## 维护 Schema

[protocol.schema.json](schema/protocol.schema.json) 定义共享数据，[kernel-ipc.schema.json](schema/kernel-ipc.schema.json) 定义 IPC 请求和结果。类型由 [gen-types.mjs](scripts/gen-types.mjs) 生成，不手工修改生成文件。

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

[test/fixtures](test/fixtures) 保存一致性样本，与协议定义分开；仅 IPC 样本通过 client 的 /protocol/ipc-fixtures.json 公开发布。标准 Draft-07 校验之外的字节、深度、唯一性与执行状态语义由运行时校验器维护，生成类型不代替输入校验。

实现入口：[InvokeInput](src/invoke-input.ts)、[事件与校验](src/index.ts)、[帧校验](src/run-protocol.ts)。
