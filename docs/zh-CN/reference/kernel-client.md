# KernelClient 参考

[English](../../en/reference/kernel-client.md) | [文档目录](../README.md)

连接已有本地 Kernel 的公开 SDK。创建服务见 [SDK 接入](../getting-started/sdk.md)；非 TypeScript 客户端见 [Kernel IPC](kernel-ipc.md)。

## attachKernel

### 示例

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";

const client = attachKernel({ endpoint });
try {
  const run = client.invoke(
    { parts: [{ type: "text", text: "Inspect the project." }], protocol_mode: "canonical" },
    undefined,
    undefined,
    agentEnv
  );
  for await (const event of run) {
    console.log(event);
  }
} finally {
  client.close();
}
```

### Payload 定义

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `endpoint` | `string` | 必填，有效的本地 Unix socket 或 Windows named pipe 地址。 |

返回 KernelClient。`attachKernel` 校验地址但不启动服务；`status()` 发起就绪查询。示例中的 endpoint 与 agentEnv 由调用方提供。

### 注意事项

独立应用使用 `@mininglamp-oss/octo-runtime-client` 根入口；`/protocol` 提供共享公开类型和校验器。客户端仅拥有自己的连接和调用登记，`close()` 不取消已接纳执行，也不关闭 Kernel。

## KernelClient 方法

| 方法                                                   | 用途与返回值                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `invoke(inputs, sessionId, providerSession, agentEnv)` | 返回异步输出流，读取时提交请求，并自动处理执行标识和有限重连。普通调用使用此方法。                      |
| `interrupt(invocationId, reason?)`                     | 取消同一客户端通过 invoke 发起的调用，返回 `{accepted}`。                                               |
| `respondInteraction(invocationId, response)`           | 回复该调用的 canonical 交互请求。                                                                       |
| `respondNativeInteraction(invocationId, response)`     | 回复该调用的 Provider 原生交互请求。                                                                    |
| `status()` / `list()`                                  | 分别查询 Kernel 状态，或已注册 Adapter 元数据及 Provider 探测结果。探测不证明已登录或具有模型访问权限。 |
| `close()`                                              | 关闭客户端连接，不取消已提交的执行，也不关闭 Kernel 服务。                                              |

只有需要自行管理提交和订阅时，才使用下面的底层方法：

| 方法                                                      | 用途与返回值                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `submit(input, environment?)`                             | 提交一次执行并返回 `{ref}`；随后由调用方订阅输出和处理恢复。  |
| `get(key, expectedInstance?)`                             | 查询原执行的 ref、仍可读取的输出范围和最终状态。              |
| `subscribe(ref, afterSeq = 0, signal?)`                   | 从指定序号之后读取 HostFrame；signal 只停止订阅。             |
| `cancel(ref, reason?)`                                    | 按完整 ref 取消执行；返回是否接受请求，最终结果仍从输出读取。 |
| `respond(ref, response)` / `respondNative(ref, response)` | 按完整 ref 回复交互请求。                                     |

## 返回 Payload

| 返回值 | 字段定义 |
| --- | --- |
| `KernelInvocation<T>` | 异步迭代器；立即提供 invocationId、runId、sessionId；首次消费提交。native 返回 HostFrame，canonical 返回 CanonicalEvent。 |
| `{accepted}` | boolean，仅表示取消是否受理；执行终态继续从原流观察。 |
| `KernelStatus` | ipc_version 固定 2；kernel_instance_id 为当前服务实例字符串；pid 为正整数；execution_ready 为 boolean；可选 service_processes 为资源快照数组。 |
| `HostedAdapterMetadata[]` | 每项包含 type、workspace、processModel、transport、protocolSupport、available，以及可选 unavailableReason、providerPath、providerVersion；不包含模型目录，不证明登录或模型权限。 |
| `RunSnapshot` | ref 为完整 RunRef；oldest_seq 为正安全整数，latest_seq 为非负安全整数；可选 terminal 为最终 HostFrame。 |
| `RunRef` | kernel_instance_id 加执行回执的 run_id、invocation_id、stream_id、agent_session_id、session_generation、protocol_mode、protocol。按原样保存。 |

invoke 的内容、会话和配置字段见 [Invoke API](invoke-input.md)；交互回复 payload、时序和接纳结果见[输出与控制](output-and-control.md)。

## 管理客户端尚未结束的调用

`client.invocations` 最多跟踪 128 个通过 `invoke` 发起的调用，包括结果未知的调用。底层 `submit` 不会自动加入此表。

- `snapshot()` 返回调用元数据。
- `stopAdmission()` 停止接受新的 invoke。
- `drain({deadline, reason})` 取消并等待已登记调用，返回 `complete` 和 `unresolved`。`deadline` 是按 `Date.now()` 计算的绝对毫秒时间戳。

应用自己创建 Kernel 服务时，通常调用服务的 `close()` 即可。连接外部 Kernel 的应用，如果需要退出时取消并等待自己提交的调用，可以显式使用此表。

## 注意事项

普通应用使用 invoke，由客户端维护提交身份和有限观察恢复。低层 submit/subscribe 需要调用方保存完整引用、连续序号、取消与尾流。取消或交互响应结果未知时，不自动重发。IPC 的缓冲和重连限制见 [Kernel IPC](kernel-ipc.md)。

模型选项由应用根据 Provider、endpoint 和账号取得。list() 的探测范围仅为已注册 Adapter，不承担模型目录发现或执行准入。

来源：[客户端类型](../../../packages/octo-runtime-client/src/types.ts)、[实现](../../../packages/octo-runtime-client/src/client.ts)、[协议 Schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json)。
