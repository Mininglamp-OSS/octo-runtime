# 输出与控制

[English](../../en/reference/output-and-control.md) | [文档目录](../README.md)

## 输出模式

通过 `protocol_mode` 选择 `client.invoke` 的返回格式：

- `canonical`：返回统一的 `CanonicalEvent`，适合应用使用同一套代码处理不同 Provider。
- `native`：返回 `HostFrame`，保留 Provider 原生消息及 Runtime 控制信息，适合需要处理原生协议的应用。

默认值是 `native`，但部分 Adapter 只支持 `canonical`。普通接入建议显式设置 `protocol_mode: "canonical"`。一次调用开始后，重连时也必须使用原来的输出模式。

## 判断执行是否结束

使用 canonical 输出时，检查最终事件：`run.completed` 表示成功，`run.failed` 表示失败，`run.cancelled` 表示取消。执行失败可能通过事件返回，而不抛出异常，因此既要处理事件，也要捕获读取过程中的错误。[invokeOnce](../../examples/invoke.mts) 演示了这两种处理。

使用 HostFrame 时，通过公开的 `isHostTerminal` 判断 Runtime 最终状态。状态包括 `running`、`completed`、`failed`、`cancelled` 和 `lost`。终态不能替代资源清理确认；宿主还须单独检查自己拥有的服务的关闭结果。

`lost` 表示无法确定执行结果，KernelClient 会报告 `RUN_OUTCOME_UNKNOWN`。最终状态缺失、输出缺失和清理失败本身都不能证明成功。应用是否已保存结果、投递消息或更新 UI，需要应用另外确认。

Codex 的非空且完成的 `final_answer` 在无活动工作、无同步交互时，可于 15 秒 finalization fallback 后确认 completed。新工作、取消或已知错误使资格失效。确认后的成功不会被后续中断/退订失败改写，但清理仍独立报告 failed/incomplete。其他 Adapter 保持原有完成规则。轮次释放不关闭常驻 app-server。

## CanonicalEvent

### 示例

```json
[
  { "protocolVersion": 2, "type": "message.delta", "payload": { "messageId": "m1", "channel": "final", "text": "Done." } },
  { "protocolVersion": 2, "type": "tool_call.create", "payload": { "id": "t1", "name": "read_file", "args": { "path": "README.md" }, "status": "running" } },
  { "protocolVersion": 2, "type": "tool_call.update", "payload": { "id": "t1", "status": "completed", "output": "Project description." } },
  { "protocolVersion": 2, "type": "run.completed", "payload": {} }
]
```

### Payload 定义

事件包含必填 `protocolVersion: 2`、`type` 和对象 `payload`。以下列出全部 23 个事件类型及其用途；下表后的字段定义补充类型与必填约束。

| 类型                    | 分组        | 何时出现                                   | payload 关键字段                                                                              |
| ----------------------- | ----------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `run.queued`            | run         | 已接纳、等待执行；预留，当前没有内置发送方 | —                                                                                             |
| `run.started`           | run         | 开始执行；同 `run.queued`，预留            | —                                                                                             |
| `run.completed`         | run         | 正常结束——唯一的成功终态                   | —                                                                                             |
| `run.failed`            | run         | 执行失败                                   | `message`、`code`、`adapterType`；可能附带标准化 `failure`                                    |
| `run.cancelled`         | run         | 被取消，或流被中止                         | —                                                                                             |
| `message.create`        | message     | 一条消息开始                               | `messageId`、`role`、`channel`                                                                |
| `message.delta`         | message     | 增量文本                                   | `text`、`channel`、`messageId`                                                                |
| `message.update`        | message     | 整段替换或状态更新                         | `text`、`status`、`messageId`                                                                 |
| `model_step.started`    | step        | 一轮模型调用开始                           | `stepId`、`startedAtMs`                                                                       |
| `model_step.finished`   | step        | 该轮结束                                   | `stepId`、`status`、`finishReason`                                                            |
| `tool_call.create`      | tool        | 工具调用开始                               | `id`、`name`、`args`、`status: "running"`                                                     |
| `tool_call.delta`       | tool        | 参数或输出的流式片段                       | `id`，以及 `argsDelta`、`outputDelta`、`outputSnapshot` 之一                                  |
| `tool_call.update`      | tool        | 工具调用进入终态                           | `id`、`status`、`output`、`error`、`exitCode`                                                 |
| `tool_call.progress`    | tool        | 长任务的进度                               | `id`、`progress`（`message`、`completed`、`total`、`unit`）                                   |
| `activity.started`      | activity    | 思考、执行、等待审批或输入                 | `activityId`、`kind`、`subject`、`source`、`info`                                             |
| `activity.updated`      | activity    | 活动信息刷新                               | `activityId`、`info`                                                                          |
| `activity.finished`     | activity    | 活动结束                                   | `activityId`、`status`                                                                        |
| `plan.updated`          | plan        | 整体替换计划                               | `planId`、`revision`、`steps[]`                                                               |
| `run.notice`            | notice      | 重试、上下文压缩、改道、配置告警、模型静默           | `noticeId`、`code`、`severity`、`params`                                                      |
| `interaction.requested` | interaction | 需要审批、回答或补充输入                   | `interactionId`、`kind`、`expiresAt`、`request`                                               |
| `interaction.resolved`  | interaction | 已处理、已过期或已失效                     | `interactionId`、`status`、`outcome`、`reasonCode`                                            |
| `session.update`        | state       | Provider 会话信息变化                      | `providerSession`                                                                             |
| `usage.update`          | state       | 本轮 token 用量                            | Adapter 归一的计数，如 `inputTokens`、`outputTokens`，可选 `cumulative`、`modelContextWindow` |

| Payload 字段 | 定义 |
| --- | --- |
| 消息字段 | messageId、role、text 为 string；channel 为 analysis/commentary/final；exposure 为 public_reasoning/public_summary/public_plan/private_reasoning/unknown。具体 Provider 可补充结构化字段。 |
| `model_step.started / finished` | 必填非空 stepId；finished 必填 status=completed/failed/cancelled。可选 startedAtMs/endedAtMs 为正安全整数，finished 可选 finishReason 字符串。 |
| `tool_call.create` | 必填 id、name 非空字符串、args 对象和 status="running"。 |
| `tool_call.delta` | id 非空；至少提供 argsDelta、outputDelta 或 outputSnapshot 中的字符串字段。argsDelta 按顺序拼接后解析；outputSnapshot 整段替换。 |
| `tool_call.update` | 必填 id 和终态 status=completed/failed/cancelled；可选 output 为 JSON、error 为对象、exitCode 为整数、durationMs 为非负安全整数。 |
| `tool_call.progress` | 必填 id 和 progress 对象；progress 可含 message（最多 4096 码点）、completed（非负安全整数）、total（正安全整数）、unit=items/bytes/steps。 |
| `activity.started` | 必填 activityId、kind、subject、source、info；kind 为 starting/thinking/executing_tool/responding/waiting_approval/waiting_input/compacting/retrying/working；source 为 provider/harness。可选 startedAtMs。 |
| `activity.updated / finished` | updated 必填 activityId 和 info；finished 必填 activityId 和 status=completed/failed/cancelled/superseded，可选 endedAtMs。活动时间戳为非负安全整数。 |
| `plan.updated` | 必填 planId、正安全整数 revision、explanation（string 或 null）、steps 数组（最多 200 项）。每步含非空 text（最多 4096 码点）和 status=pending/in_progress/completed/blocked/cancelled。 |
| `run.notice` | 必填 noticeId、code、severity=info/warning、params 对象；code 为 retry_scheduled/context_compacted/model_rerouted/config_warning/provider_diagnostic/model_output_idle。params 值为 string/number/boolean，可选 relatedActivityId/relatedItemId。 |
| `interaction.requested / resolved` | 见本页交互定义；interactionId 和 executionInstanceId 必填非空字符串，最长 191 码点。 |
| `session.update` | providerSession 为完整 ProviderSession，保存后用于显式恢复，见 [Invoke API](invoke-input.md)。 |
| `usage.update` | Adapter 提供 inputTokens/outputTokens 等计数，可含 cumulative、modelContextWindow；字段缺失不表示零。 |

activity 的 activityId、planId、工具进度 id 和 noticeId 最长 191 码点。subject、info、provenance 和 failure 的嵌套结构见[协议 Schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json)。输出字段开放性与事件专属语义分别校验，不能从一个事件推断所有事件具有相同的必填字段。

### 注意事项

run.queued 和 run.started 在类型集中预留，当前无内置发送方。只有 run.completed/run.failed/run.cancelled 是 canonical 终态。消息、工具完成、取消 ACK、进程退出和流 EOF 均不等于 Run 成功。

final 文本可先于终态返回。analysis 只在 exposure 为 public_reasoning、public_summary 或 public_plan 时公开。关联消息和工具时使用 messageId、stepId、工具 id，不通过文本相似度推断。

## HostFrame 的结构

HostFrame 带有执行和会话标识：`run_id`、`invocation_id`、`stream_id`、`agent_session_id`、`session_generation`，以及 `protocol_mode`、`protocol`。`seq` 是从 1 开始的输出序号，用于断线后继续读取。

帧分三类：`native` 保存 Provider 原生数据和扩展字段，`canonical` 的 `event` 保存统一事件，`control` 报告状态、错误、交互状态和输出缺失。三类帧共同使用同一套 `seq`。如果自己实现 IPC 客户端，应保存收到的帧序号，不能用 canonical 事件数量推算读取位置。

### Payload 定义

| 字段 | 类型与含义 |
| --- | --- |
| `run_id / invocation_id / stream_id / agent_session_id` | 必填非空字符串，各最多 256 码点；来自原执行回执。 |
| `session_generation` | 必填非负安全整数。 |
| `protocol_mode` | 必填 native 或 canonical；`protocol` 为必填非空字符串，最多 128 码点。 |
| `seq` | 必填正安全整数；所有帧共用连续序号。 |
| `kind` | native/canonical/control，决定下列负载。 |
| `messageKind / payload` | native 必填；messageKind=response/notification/request/message；payload 为 Provider 原生对象。 |
| `event` | canonical 必填，完整 CanonicalEvent。 |
| `control` | control 必填，见下表。 |

| control.type | Payload |
| --- | --- |
| `state` | state=running/completed/failed/cancelled/lost。 |
| `error` | code 和 message 字符串，可选标准化 failure。 |
| `interaction` | requestId 为非空字符串或安全整数，status=pending/resolved/expired/invalidated；pending 必含正安全整数 expiresAt（Unix 毫秒），可选 responseRequired。 |
| `gap` | requested_after_seq、oldest_seq、latest_seq，报告续流窗口缺失。 |
| `evidence` | name="session"，payload 为会话事实对象。 |

### 注意事项

原生 request ID 与 canonical interactionId 分别使用对应的回复 API。control.error、gap 和 lost 可导致高层视图抛错，须同时处理流异常和事件终态。

## 模型输出静默通知

首次区间从 Core 开始本轮 Adapter 调用时计时。canonical 执行在连续 60 秒没有新的公开模型文本时，由 Runtime 发出一次 `run.notice`，code 为 `model_output_idle`。收到新文本 delta 或增长的文本快照，立即从零重新计满 60 秒；即使上一段已通知，下一段仍会再次通知。空内容、重复或回退快照、心跳、usage、私有 reasoning 不刷新计时。排队、工具执行和同步审批/输入等待期间暂停，最后一个等待解除后重新计时；异步问题不暂停。

已经达到阈值并生成的通知会保留到交付，新输出只重置下一段计时；该通知先于同时就绪的普通模型输出交付。终态、取消或异常仍优先清除尚未交付的通知。

`silenceMs` 是 Runtime 单调时钟测得的实际毫秒数；timer 迟到时可能大于 60000。message 使用对应整数秒数，例如 `60s no LLM output`。这是信息通知，不是终态、取消指令或周期心跳。现有预算仍生效：默认首帧预算 60 秒可能先触发失败，`model_idle_policy: observe` 只关闭模型空闲终止，不关闭首帧、整轮或工具预算。

`client.invoke` 的 canonical 视图收到以下内容：

```json
{
  "protocolVersion": 2,
  "type": "run.notice",
  "payload": {
    "noticeId": "idle-1",
    "code": "model_output_idle",
    "severity": "info",
    "params": {
      "silenceMs": 60000,
      "message": "60s no LLM output"
    }
  }
}
```

IPC 则复用既有 JSON-RPC 2.0 `agent_run.event` 通知外壳，无 `id`，`params.event` 是原 HostFrame，里面的 `event` 才是上述 notice：

```json
{
  "jsonrpc": "2.0",
  "method": "agent_run.event",
  "params": {
    "kernel_instance_id": "kernel-1",
    "run_id": "run-1",
    "stream_id": "stream-1",
    "seq": 8,
    "event": {
      "run_id": "run-1",
      "invocation_id": "invocation-1",
      "stream_id": "stream-1",
      "agent_session_id": "session-1",
      "session_generation": 1,
      "seq": 8,
      "protocol_mode": "canonical",
      "protocol": "codex.app-server",
      "kind": "canonical",
      "event": {
        "protocolVersion": 2,
        "type": "run.notice",
        "payload": {
          "noticeId": "idle-1",
          "code": "model_output_idle",
          "severity": "info",
          "params": {
            "silenceMs": 60000,
            "message": "60s no LLM output"
          }
        }
      }
    }
  }
}
```

续流保留原身份、序号及测量值，不重新计时。静默通知只用于 canonical，不改变 native 输出。通知不能保证中间网络设备保持连接；断线恢复见 [Kernel IPC](kernel-ipc.md)。

## 取消

在创建句柄的 client 上调用 `client.interrupt(run.invocationId, reason?)`。公开 invoke 的取消入口是 interrupt。身份立即可读；提交前中断阻止发送，提交后只控制原执行，并保留原流尾事件的观察。

取消受理 ACK 不代表执行终态或清理完成；继续消费原流确认结果。已接纳的 KernelClient 调用上，break/return/throw/close 只结束观察。提交前 return/throw 会释放本地登记；直接 Core 执行迭代器仍保留其内部取消合同。参见[标识所有权](../concepts/identifiers.md)。

## 回复审批和用户问题

> **交互处理要求：登记或展示交互前，必须先检查 `payload.delivery`。** `delivery: "async"` 是可选的旁路信息补充，不表示执行正在等待用户。没有实现下述异步合同时，不得直接接入已有同步表单、`/respond` 命令或等待状态处理器。

canonical 模式的 `interaction.requested` 包含 `interactionId`、`executionInstanceId` 和 `request`。`kind` 表示交互类型：`approval` 是审批，`question` 是追问，`elicitation` 是请求用户补充信息。同步请求必须有 `expiresAt`（ISO 时间戳），异步问题可省略。以下回复流程适用于同步交互：

1. 将 `request` 展示到应用的交互界面。
2. 收集用户决定或回答。
3. 在原客户端上调用 `client.respondInteraction(invocationId, response)`。
4. 继续读取事件，直到执行结束。

共享的[交互示例](../../examples/interactions.mts) 使用应用提供的决策函数完成这个流程。不要根据普通 Context 中的文字自动批准请求。

审批回复包含 `{interactionId, outcome}`，例如 `accepted`、`declined` 或 `cancelled`。追问和信息补充使用 `outcome: "answered"`，并按请求填写 `value`。具体格式见 [InteractionResponse 类型和校验器](../../../packages/octo-runtime-protocol/src/index.ts)。回复应对应原请求，不能扩大其申请的权限范围。

native 模式下，保存 Provider 的 request ID，再调用 `respondNativeInteraction(invocationId, {requestId, payload})`。`payload` 必须符合该 Provider 对当前待回复请求的响应格式。Provider 的初始化和本轮执行仍由 Driver 管理，不能通过此接口另外启动 turn 或修改账户、全局配置和任意 thread。

HostFrame 的 control 消息报告交互状态：`pending`、`resolved`、`expired`、`invalidated`，其中 `pending` 的期限使用 Unix 时间戳毫秒数。回复被接受后，还会通过后续通知更新状态。已过期、已回复、属于旧执行、模式错误或执行已结束的请求不能再次回复；取消或执行丢失也会使待回复交互失效。

`full_access` 策略可以处理受支持的审批，但不会替用户回答追问或信息补充请求。

### 异步问题合同

Codex 可在继续工作时发布 `kind: "question"`、`delivery: "async"` 的 `interaction.requested`。表单打开期间仍需持续读流。请求结构为 `{schema: "octo.question-request/v1", messageId, questions: [{id, title, options, allowCustom: true}]}`；选项可为 null 或空数组，始终支持自定义文本。原请求与宿主持有的 pending 状态授权补答，不能仅凭消息快照推断可答。用 messageId 关联成一个表单，不解析 Markdown。

整批提交一次，使用 `outcome: "answered"`，以及 `value: {schema: "octo.question-response/v1", answers: [{questionId: "q:0", text: "选项原文或自定义答案"}]}`。每个题目 ID 必须恰好回答一次；每题非空白且不超过 4096 Unicode 码点。公开入口示例见 [asyncQuestionForm](../../examples/interactions.mts)。

Runtime 向原活动轮次发送一次 `turn/steer`，匹配的 RPC 成功响应到达后，Promise 才成功，并发布 `resolved/answered/provider_accepted`。它只证明 Provider 接纳，不证明落盘、模型已阅读或任务成功。`ASYNC_ANSWER_REJECTED` 表示明确拒绝；`OPERATION_OUTCOME_UNKNOWN` 表示已发送但未确认，两者均不得自动重试。`INVALID_QUESTION_RESPONSE` 可在发送前修正；重复或失效提交报 `INTERACTION_NOT_ACTIVE`。

异步 ask 是会话旁路补充：可以不填，原任务照常结束；正常完成后仍可通过同一表单补答。公共 `/executor-kernel` 的 `AsyncQuestionReply` 在活动时 steer，确认正常完成后复用 `client.invoke` 创建新的 AgentRun。宿主显式提供当前会话的 continuation input（sessionId/generation/providerSession/agentEnv），SDK 生成新执行身份，并携带原题和答案。Codex 新 Run 强制 `providerSession.requireResume=true`，恢复失败即失败，不能另开 Provider 会话。

`respond` 返回 `route: "steer"` 时已获 Provider 接纳；返回 `route: "new_run"` 时只提供 `events` 执行流，消费流才提交，不能显示答案已送达。新 Run 的 Runtime 受理、Provider 接纳、模型使用与任务完成分别观察。完整示例见 [asyncSupplementForm](../../examples/interactions.mts)。原低层 respond 仍只接受活动 Run。

旁路默认不设到期时间；可选 expiresAt 到期后拒绝，同步交互仍必须提供期限。cancel 只关闭表单，不取消模型。宿主唯一控制者负责保存 `snapshot()`，持续通过 `observe` 记录原 Run 的真实终态及交互结果；保存为 pending/completed 的问题可在重启后续跑，仅 running 或提交未知不能重放。已提供的会话身份/代次不匹配时拒绝旧题；业务绑定与配置的区别及宿主责任见下节。steer ACK 丢失返回未知，绝不转新 Run 或自动重交。SDK 不提供宿主数据库事务或跨控制者恰好一次保证。

同步与异步共享 16 个活动交互上限；每批最多 50 题，每题最多 50 个选项，题目及选项各最多 4096 码点。损坏或超限问题明确失败。同步问题、elicitation、审批和 full_access 语义保持原样。宿主仍需接入表单界面，不解析 Markdown。

### 续跑配置由应用决定

`agentEnv` 是本次执行配置，不是会话身份。Runtime 不对整个 agentEnv 做跨轮签名或相等性检查；它的变化本身不使旧问题失效。宿主可以明确授权下一轮调整思考强度、刷新环境变量、修改 MCP、审批策略或工作目录，但执行权限校验和 Provider 的恢复/配置支持仍然适用。

| 场景 | 配置与责任 |
| --- | --- |
| 原 Run 仍活动 | 按原 RunRef/interactionId steer；continuation 的 agentEnv 不修改或重定向原执行 |
| 原 Run 已确认正常完成 | continuation 由宿主明确选择并授权下一轮 agentEnv；SDK 创建新执行身份并要求恢复原 Provider 会话 |
| 会话 reset 或 Provider 绑定替换 | 宿主隔离旧表单；显式 sessionId/generation、Provider sessionId 或 epoch 不匹配时 SDK 拒绝 |
| 目标或授权无法确认 | 宿主拒绝 continuation，不能将未经确认的全局“当前配置”当作续跑许可 |

`providerEpoch` 可选，由应用在其认定的 Provider 绑定替换时维护；不要求每次 agentEnv 调整递增。使用时须将原值保存到问题 snapshot；两边均省略仅表示缺少这项版本保护。SDK 不自动检测相同 ID 背后的 Adapter、账号、服务端或外部配置变更。宿主未使用 epoch 时仍须主动使被替换绑定的旧表单/控制者失效，不能将原 providerSession 投向另一个 Provider 身份域。

`respond()` 读取并复制 continuation input，包括 agentEnv；消费返回的 events 前，再调用 continuation 核对会话/代次。后一次读取不会替换已捕获的 agentEnv。宿主须在提交和消费前核对自己的业务授权，必要时让回调抛错；SDK 的身份复核不代替业务授权，也不提供跨业务存储事务。若要使用新的配置，应在调用 respond 前完成选择。

因此，文档中的“旧绑定失效”不是“环境必须永久不变”。这是业务授权下的新执行，恢复失败明确失败，未知投递不能借配置变化重新发送。当前约束不宣称所有外部应用已正确维护 epoch；各应用需验证自己的绑定变更与表单生命周期。

### 应用必须明确选择处理方式

**所有消费交互事件的应用，都必须明确选择以下一种策略：**

- **不支持异步表单：** 在交互登记、秘密输入检查、命令/卡片生成及等待状态投影之前忽略 async `interaction.requested`。按原 Run 保存其 `interactionId`，并配对忽略不携带 `delivery` 的 `interaction.resolved`。继续读流、推进原游标、正常展示消息正文；不自动回答、不暂停，也不能让被忽略的 resolved 清掉同步问题的等待状态。身份记录必须有容量上限并随所属 Run 清理。
- **支持异步表单：** 保留原请求、题目身份、Provider/会话绑定和提交状态，收集完整的 `octo.question-response/v1` 答案批次，支持自定义文本与取消，并接入上述公共 `AsyncQuestionReply` 生命周期。明确处理期限、重复提交、旧绑定、重启及未知投递；运行中 steer，确认正常完成后才允许同会话新 AgentRun。Provider 接纳前不得报告送达。

async 缺少 `expiresAt` 是合法状态，不表示已过期；回答必须是结构化整批数据。应按 `delivery` 分流，不能用 `kind`、`full_access`、题目文案或有无选项猜测。`responseRequired: false` 仅用于自动审批，不能用来识别异步问题。

业务 UI 自行决定异步问题的展示及响应策略；公共协议支持不等于客户端 UI 自动支持。

## 错误与恢复

记录错误对象中的稳定错误码，再决定如何恢复。例如，输入错误应修正参数，输出连接断开应查询原执行。如果提交回执丢失，Provider 可能已经开始工作，此时直接重试 `invoke` 可能重复执行。重连步骤见 [Kernel IPC](kernel-ipc.md)，常见错误见[故障排查](../guides/troubleshooting.md)。

来源：[帧校验与 canonical 视图](../../../packages/octo-runtime-protocol/src/run-protocol.ts)、[事件类型](../../../packages/octo-runtime-protocol/src/index.ts)、[Kernel client](../../../packages/octo-runtime-executor-kernel/src/client.ts)。
