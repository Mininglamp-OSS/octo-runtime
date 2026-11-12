# Executor Core

[English](README.md) | [包导航](../README.zh.md)

AgentExecutor 是 Runtime 的执行实现，供 Kernel 集成与底层执行语义测试使用。标准应用接入通过 [KernelClient](../../docs/zh-CN/reference/kernel-client.md)；本包为 private workspace 源码依赖。

## 最小用法

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter); // metadata.type is "dsh"; a duplicate type throws

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
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});

try {
  let terminal: string | undefined;
  for await (const event of executor.invoke({ ...input, protocol_mode: "canonical" })) {
    if (event.type === "message.delta" && event.payload.channel === "final")
      process.stdout.write(event.payload.text ?? "");
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
    if (event.type === "run.failed") throw new Error(JSON.stringify(event.payload));
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const { cleanup } = await executor.shutdown();
  if (cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

## 包 API

| 方法 | 职责 |
| --- | --- |
| register(adapter) | 按 metadata.type 注册，重复类型拒绝。 |
| list() / describe(configurations?) | 列出注册信息；describe 探测绑定目标，探测不证明模型可用。 |
| invoke(input, environment?) | 返回所选模式的输出流。 |
| invokeFrames(input, environment?) | 保留 HostFrame 和连续序号。 |
| cancel(invocationId) | 请求取消，仅返回受理事实。 |
| respondInteraction / respondNative | 响应所属执行的有效交互。 |
| shutdown(reason?, timeoutMs?) | 关闭接纳，等待自有资源清理并返回清理快照。 |

直接 Core 的本地迭代器提前结束会请求取消；KernelClient 的观察停止语义见其参考。invokeFrames 在调用时校验，invoke 在首次消费时校验；消费循环应处理异常。shutdown 的 state=closed 仅说明接纳关闭，cleanup=complete 才表示其自有资源清理完成。共享 Engine 的所有权由宿主与 Adapter 明确约定。

## 参考与实现

- [Invoke API](../../docs/zh-CN/reference/invoke-input.md)、[Inputs](../../docs/zh-CN/reference/input-parts.md)、[AgentEnv 标准参考](../../docs/zh-CN/reference/agent-env-standard.md)。
- [输出与交互](../../docs/zh-CN/reference/output-and-control.md)、[Adapter 私有配置](../../docs/zh-CN/reference/agent-env/private-items.md)。
- [实现与导出](src/index.ts)、[输入准备](src/invoke-input.ts)、[watchdog](src/watchdog.ts)、[清理预算测试](../../test/executor-cleanup-budget.test.js)。
