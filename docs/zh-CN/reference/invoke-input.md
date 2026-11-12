# Invoke API 与 IPC 输入

[English](../../en/reference/invoke-input.md) | [文档目录](../README.md)

## KernelClient.invoke

`client.invoke(inputs, sessionId, providerSession, agentEnv)` 返回 KernelInvocation 异步迭代器。调用时校验、生成身份并冻结输入，首次消费才提交。

| 参数 | 类型与行为 |
| --- | --- |
| inputs | 必填 ModelInputPart[] 或 InvocationContent，见下表与 [输入 Parts](input-parts.md) |
| sessionId | 可选非空 string，传 undefined 由 client 生成；业务关联身份，不恢复 Provider。 |
| providerSession | 可选完整 opaque ProviderSession 对象，undefined 表示新建。见下节。 |
| agentEnv | 必填，仅含 schema/items。空 items 合法但不保证可执行。 [AgentEnv](agent-env-standard.md) |

### InvocationContent

高级形式只承载内容、输出模式和追踪字段，不含 agentEnv、sessionId、providerSession 或 signal。

| 字段 | 类型 | 要求与缺省 |
| --- | --- | --- |
| `parts` | `ModelInputPart[]` | 高级内容必填，1–128 项；低层字段名为 inputs。 |
| `protocol_mode` | `"native" \| "canonical"` | 可选，默认 native；须满足所选 Adapter 输出模式。 |
| `invocationId / runId` | `string` | 可选非空字符串，省略由 client 生成；分别用于取消定位与业务 Run 关联。 |
| `sessionName` | `string` | 可选，1–256 Unicode 码点，不能纯空白或含控制字符，且最多 512 UTF-16 单元；仅展示，省略由 Core 提供 UUID。 |
| `sessionGeneration / providerEpoch` | `number` | 可选非负安全整数；由调用方维护业务会话代次与 Provider 绑定代次，不因 agentEnv 变化自动递增。 |
| `prompt` | `string` | 可选非空展示说明，省略取输入的文本摘要；不替代 Provider 正文。 |
| `modelInput` | `string` | 可选非空完整主正文；只替换纯文本主输入。 |
| `runMetadata` | `Record<string, unknown>` | 可选 JSON 对象，用于追踪，不作为模型正文或授权证据。 |
| `continuityMode` | `"fresh" \| "continue"` | 可选；有 providerSession 默认 continue，否则 fresh；实际恢复失败行为仍由 Provider 合同决定。 |
| `freshFallbackModelInput` | `string` | 可选非空完整恢复文本，优先级低于恢复 parts。 |
| `freshFallbackModelInputParts` | `ModelInputPart[]` | 可选完整恢复 parts；结构与主输入相同，须保留当前图片及顺序。 |
| `freshFallbackImagesUnavailable` | `boolean` | 可选；true 时进入 fresh fallback 明确失败。 |

文本/图片字段、容量、完整性及主输入/恢复输入选择规则集中在 [模型输入参考](input-parts.md).

### ProviderSession

按原样保存并回传上轮 session.update 返回的完整对象，不只保留 sessionId。必填 sessionId 为非纯空白字符串；可选 resumable、requireResume 为 boolean；resumeOutcome 为 new/resumed/fresh_fallback/compacted；resumeFallback 为 string；contextInputVariant 为 primary/recovery。对象可含 Provider 扩展字段，应完整保留。业务 sessionId 不替代这个恢复句柄。

同一业务会话不证明可以跨 Adapter、账号或服务端恢复。代次与所有权见 [标识参考](../concepts/identifiers.md) 与 [会话指南](../guides/context-and-sessions.md).

## 句柄、中断与收尾

run.invocationId、run.runId、run.sessionId 立即可读。未消费句柄也占 client 的 128 条登记预算；消费、return()、throw()、interrupt() 或 owner drain 负责释放。client.interrupt(run.invocationId, reason?) 只控制本 client 的原调用。

提交前中断阻止发送，迭代器抛可由 isInvocationNotSubmitted 识别的错误；提交后继续消费原流至终态。结束已接纳调用的观察不会隐式取消执行。受理 ACK、中断 ACK、执行终态、业务投递和资源回收是不同事实，见 [输出与控制](output-and-control.md).

## 低层 InvokeInput 与 IPC v2

CLI JSON/client.submit 使用下列形状。InvocationContent.parts 改名为 inputs，sessionId/providerSession/agentEnv 平铺；其他内容字段同上。

```json
{
  "inputs": [{ "type": "text", "text": "Inspect the prepared project." }],
  "sessionId": "conversation-42",
  "protocol_mode": "canonical",
  "agentEnv": {
    "schema": "octo.context-envelope/v3",
    "items": [
      { "namespace": "octo.execution", "name": "adapter", "payload": { "type": "codex" } },
      { "namespace": "octo.execution", "name": "workspace", "payload": { "path": "/absolute/prepared/project" } }
    ]
  }
}
```

InvokeInput.check 校验 JSON 边界，Adapter 校验执行语义。inputs 与 agentEnv 必填，未知顶层字段拒绝。submit/subscribe 为高级 API，调用方持有完整 RunRef、取消与尾流，不自动加入 invoke 登记。传输最大 32 MiB。

## 合同来源

[InvokeInput / InvocationContent](../../../packages/octo-runtime-protocol/src/invoke-input.ts), [Client](../../../packages/octo-runtime-client/src/client.ts), [IPC](kernel-ipc.md).
