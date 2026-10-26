---
type: Journal
title: Windows 运行可靠性专项实施
description: 四项问题的修复、真实 Windows 回归及同基线全量对照。
tags: [runtime, lifecycle, adapter, envs, installation, testing]
---

# 实施与证据

从最新 `origin/main@8af8360` 建立独立 worktree 和 `fix/windows-runtime-reliability` 分支，按 [OctoSpec 简报](../../tasks/windows-runtime-reliability/brief.md)处理 #131、#135、#134、#146；[可执行性评估](../../tasks/windows-runtime-reliability/assessment.md)为 97/100，仅表示准备度。

Windows 孤儿回收改用身份匹配后的 `taskkill /T /F`，失败持久保留 `cleanupIncomplete` 并阻止替代启动；Adapter 输出管道错误限定在本次调用，保留清理及原始 spawn 错误。服务 XML 改 UTF-16LE BOM，查询显式 UTF-8，实际账号按 SID 比较。环境覆盖统一逐层合并，Windows 忽略键大小写，POSIX 保持原语义。规则已回写 [本地执行](../../rules/local-execution.md)、[生命周期](../../rules/runtime-lifecycle.md)和[环境](../../rules/environment.md)。

Windows Server 2022、Node 24.22.0 上，真实三代进程、共享 worker 活动 sibling 和后续调用、281 字符 cwd 故障、实际子进程环境及四组 SDK/CLI 原生任务安装矩阵通过。类型、构建、lint、命名和格式检查通过。完整 UI 35 通过；Node 为 1668 通过、95 失败、70 跳过。未修改 `main@8af8360` 全量对照为 1654 通过、同名 95 失败、70 跳过，新增 14 项全部通过。OctoSpec lint 与基线一致，仅四个旧文件缺少 frontmatter；详见[实施与验收](../../tasks/windows-runtime-reliability/validation.md)。

Windows Node 24/26 CI 已纳入显式专项回归，本地验收时尚未推送执行。leader 预先消失、系统级 PID 竞态、普通账号、Windows 10/11、其他 locale 与 Node 26 本机验证仍保留边界。原生测试已清理自身命名任务和进程。

用户随后授权英文提交、正式 PR 及合入 main，并要求先 rebase 当前分支。已重新 fetch 并执行 `git rebase --autostash origin/main`：最新 main 仍为 `8af8360`，分支已是最新，自动暂存完整恢复。后续按托管 CI、至少一位 reviewer 批准及保护规则交付，不发布 npm；远端完成状态以 PR 为准。

# PR 179 评审修复

首版以英文提交 `6e2f54b` 创建正式 [PR #179](https://github.com/Mininglamp-OSS/octo-runtime/pull/179)，六个平台/Node 组合及 CI Gate 通过。三份评审提出修改后，按实际代码和 Windows 原生复现完成[逐项核验与处置](../../tasks/windows-runtime-reliability/review-fixes.md)：修复大小写合并后的 MCP/可执行程序消费者及 ACP/Grok 最终 spawn，增加有原文归档和摘要绑定的显式孤儿恢复命令与 doctor 诊断，将持久阻塞限定于 Windows，区分 SID 查询未知与确实不匹配，并补公共 XML 序列化说明。

本轮新增 11 项回归通过，与相邻回归合计 29 项通过。rebase 前完整 Node 1679 通过、95 失败、70 跳过，UI 35 通过；相对旧 main 新增 25 项全部通过，失败集合无变化。类型、lint、命名与格式通过，OctoSpec 仍只有四处基线旧错误。

提交前再次 fetch，发现 main 已有 #177/#178，已将当前分支 rebase 至 `78bb88a`，保留上游 DSH 官方 SDK 变更并重新 frozen install/build；主仓库 main 同步至该提交。新基线对照与当前 head CI 单独验收，不能复用首版 CI 作为通过证明。合并仍受至少一位 reviewer 批准与 CI Gate 约束。

rebase 后 29 项定向回归、5 项原生任务测试及工程/文档检查通过。完整 Node 1673 通过、94 失败、70 跳过，UI 35 通过；最新 main 为 1647 通过、95 失败、70 跳过。分支失败全部属于基线，基线额外 1 项 2 秒超时断言单独重跑通过；相对新 main 新增 25 项全部通过。OctoSpec 检查两边同为 7 处基线 frontmatter 错误。全量仍非全绿，见[验收](../../tasks/windows-runtime-reliability/validation.md)。
