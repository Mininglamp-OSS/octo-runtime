# IM 助理模型静默后的自动续接

用户要求：连接的助理遇到 OH-ADP-3008 后自动中断并在原会话继续，桌面和 IM 显示同一逻辑任务；提交 Runtime PR 和 Client MR。

## 交付边界（草稿）

已完成严格停止证据、安全续接与逻辑状态合同。**尚未接通已复现产品路径中的共享 daemon 原任务重订阅，也未完成 Client 新 SDK 迁移；不能把原断联事故写成已修复。** 代理退出只结束观察连接，真实后台任务可能继续。重新连接应订阅原执行，不是创建新 turn。

## 产品意图归属

- 宿主显式配置 `codex_retry.resume_on_model_silence`；缺省 false，不改变其他 SDK 产品和 Adapter。
- Channel 的 ImTask 决定是否续接、累计次数、退避和逻辑任务终态；Core 只提供本次清理事实，仍只执行一次 invoke。
- `max_model_silence_resumes` 默认 2、范围 0..5，另受已有总次数、连续恢复预算和任务总期限限制。
- 续接必须在原流正常耗尽后，具有可恢复原 Provider session、本次 Core 的 `executionCleanup: complete`、Adapter 从匹配原生 thread/turn 得到的 `executionStopped: confirmed` 且 `executionStoppedState: cancelled`、模型静默证据与零开放工具。取消 ACK 或代理进程清理不能替代实际停止。工具失败、取消、缺失 create 的更新及交互均禁止续接。已经完成的工具不重放原用户输入。续接显式使用 Codex 的 `providerSession.codexRequireResume`，旧会话丢失时禁止回退新会话。
- 同一逻辑 taskRunId 保持，续接生成新的 runId/invocationId；通过 binding.task 发布 running/recovering 和最终结果。reset 后旧任务不得覆盖新代次。
- 断流或状态未知不重新提交，不把取消受理当成停止；Kernel 既有订阅修复保持原职责。进程重启后的自动业务恢复不在本次范围。
- 元数据不含正文、输入、工具结果、凭据；可选宿主 store 决定持久化，默认内存容量保持。

## 验收

覆盖实际清理成功/超时、原会话续接、工具安全门、退出/重置、预算和次数、终态后传输错误、宿主状态写入失败、单一逻辑终态。记录本地检查与未做的真实 Provider/IM 联调，不以 fake 代替现场事故诊断。

## 集成约束

OctoBuddy 当前仍固定内部旧 daemon SDK，而 GitHub main 使用 Kernel/Host SDK。配套 Client MR 是依赖本 PR 的接入准备；必须在 Runtime 合入并发布后完成 SDK 迁移、固定真实版本和打包联调，不能声称旧版本已生效。原截图的空模型目录错误是独立 CLI 问题，不纳入此 PR。
