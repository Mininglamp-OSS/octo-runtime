---
type: Journal
title: 助理静默超时恢复的安全边界与逻辑状态投影
description: 记录实际执行停止证明、严格原线程续接及共享 daemon 原流恢复的未完成边界。
tags: [channel, recovery, session, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 范围与实际问题

本分支基于 GitHub main `13f05e0`，对应[任务](../../tasks/assistant-auto-recovery/brief.md)。提供严格停止证据、安全续接、逻辑任务合同及日志关联；**仍为草稿，不宣称修复 OctoBuddy 私有共享 daemon 的断订阅。** Client 当前内部旧 SDK 与 GitHub Kernel/Host SDK 的迁移尚未完成。

排查得到：service 模式启动的是连接共享 daemon 的代理，代理退出可能仅删除订阅者，后台任务继续。父任务使用已打包 CLI 的真实 daemon-service 与临时 fake Provider 隔离实验：turn/interrupt 仅 ACK、关闭代理后，另一客户端查原 thread 仍 running；stream/subscribe 读到 2 条 backlog，新订阅者最终收到 turn/completed。另一个固定 SDK ImRuntime + fake GatewayTransport/Provider 实验中，一次 OH-ADP-3008 后仍 connected/online，transportStarts=1、transportCloses=0，第二条正常执行。这些是实现行为证据，不是原事故复现；未找到用户两个诊断号的现场日志。

因此 Runtime 超时不能推导 IM 渠道离线，也不能将本地清理完成视为真实任务停止。后续产品恢复必须接回原 thread/status 与 stream/subscribe；旧任务仍运行时不提交新 turn。

# 实施与安全复核

Core 新增 Adapter 上报真实执行停止的可选边界，分别记录 executionCleanup 与 executionStopped/outcome。Codex 仅对匹配当前 thread/turn、含真实终态 status 的 turn/completed 确认；中断 ACK、乐观 run.cancelled 与子进程退出不确认。关闭前保留有界尾流观察，不以未观察到的结果补造成功。

ImTask 的模型静默续接默认关闭，宿主显式授权后也须同时满足真实 cancelled、本地清理成功、原流正常耗尽、原会话可恢复及无未决/失败工具或交互。最多两次，仍受旧预算限制。续接不用原输入，携带 Codex 严格恢复标志，旧线程丢失/恢复返回其他线程时拒绝 fresh fallback；原 turn 实际已完成时不另起任务。任务状态未知时不重新提交。

复核修复了：boundedCleanup 到期仍 resolve 不代表成功；resumable:false 不能续接；工具重复身份/缺帧/容量不足关闭续接；相同 task revision 不能丢弃 Provider binding 补写；关闭后禁止 task 状态尾写；Client 侧同进程租约结束与跨进程重启撤销旧 active 投影；unknown 不能冒充真实失败。task 只包含身份、计数和状态，不含原输入、Context、工具结果或凭据。

# 验证

- `pnpm typecheck`、`pnpm lint` 通过。
- `pnpm test:suites`：Node 1958 项，1904 通过、54 跳过、0 失败；WebUI 35/35 通过。
- 严格恢复、取消真实证明、ImTask/ImRuntime 单卡片/一次 final、stop/reset/unknown、清理证据和受管日志专项通过。Core 清理测试明确验证代理清理成功但实际停止未知时，不能据此续接。
- Client 配套工作区相关单测 112 项和定向 Electron E2E 4 项通过；其全量 E2E 17 通过、4 失败、687 未跑，因账号菜单/退出/导航失败停止长跑，未作为全量通过。
- 未完成真实 Provider/IM 与已打包新版 SDK 联调；未完成私有 daemon 原任务重新订阅；不发布版本、不更新到不存在的依赖。
