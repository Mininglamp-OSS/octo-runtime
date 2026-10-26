---
type: Journal
title: 助理原任务观察、停止证据与诊断
description: 记录仅同步原执行的职责边界、模型静默观测策略及真实执行停止证据。
tags: [channel, observation, session, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 当前需求与范围

基于 GitHub main `13f05e0`，对应[任务](../../tasks/assistant-auto-recovery/brief.md)。用户明确只要两边同步，不发送继续输入；本 PR 不新增自动执行或业务续接策略。产品专属原任务观察由配套 Client MR 接线，Generic Runtime 不调用私有 daemon 方法。

本分支保留真实停止与本地清理的独立证据、watchdog 安全测量和诊断编号关联，并验证既有 enforce/observe 合同。Generic 默认 enforce 不变；宿主显式选择 observe 时模型静默不再 abort，但工具、总期限和主动停止保持。不使用假的 turn_progress 心跳。

# 实现事实

Core 超时诊断分别保留 executionCleanup 与 executionStopped/outcome。Codex 只有匹配当前 thread/turn、含真实终态 status 的 turn/completed 才确认执行停止。关闭前最多 250ms 观察尾流；中断 ACK、乐观 run.cancelled、代理退出或清理成功均不证明后台执行停止。停止未知不作为重放或新执行授权。

watchdog 日志仅扩展已白名单化的阶段、时长、进展/传输间隔、工具与重试计数；invoke.failed 的 diagnostic_id 可关联用户诊断号。不写正文、原始错误、完整配置或凭据。日志继续遵守现有队列、容量与轮转边界。

# 隔离实验与未覆盖边界

父任务使用已打包 CLI 的真实 daemon-service 与临时 fake Provider 隔离实验：turn/interrupt 仅 ACK、关闭代理后，另一客户端查原 thread 仍 running；stream/subscribe 读到 2 条 backlog，新订阅者最终收到 turn/completed。固定旧 SDK ImRuntime + fake GatewayTransport/Provider 实验中，一次准确分类的 OH-ADP-3008 后仍 connected/online，transportStarts=1、transportCloses=0，第二条正常执行。这些证明任务失败、观察中断与渠道断线不同，不是原事故复现。

Client 可使用当前 SDK 已支持的 observe 和产品专属 Adapter 恢复原观察，不以本 PR 发布或 Kernel/Host SDK 迁移为前提。实际双端状态与最终结果验收由 Client 记录；本仓没有完成真实 IM/模型联调，也未发布任何版本。

# 本次验证

- `pnpm typecheck`、`pnpm lint`、`pnpm docs:check`、`pnpm format:check` 通过；docs 行为检查 4/4。
- `pnpm test:suites`：Node 共 1931 项，1877 通过、54 跳过、0 失败；WebUI 35/35。
- 停止/清理/日志/静默策略及既有 IM 重试专项 74/74。新增 enforce/observe 实例测试中，Provider 在 250ms 后结束、模型静默预算为 100ms：enforce 返回 OH-ADP-3008，observe 返回原执行 run.completed，二者都只接纳一次原输入。
- 源码复核确认本次不修改 Gateway 的配置、ImTask、binding 或公开 Gateway 导出；本次没有新增继续输入、业务重放或执行尝试。
- 上述自动化使用 fake Provider；本仓未做真实模型或真实 IM 联调，不将其表述为原事故复现。
