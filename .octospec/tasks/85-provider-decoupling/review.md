---
type: Task
title: Issue 85：本地代码审查与修复复审
description: 从最新 main 基线分别审查规范与需求，修复 IPC 启动预算和旧文档矛盾。
tags: [architecture, adapter, extra, testing, review]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 审查范围

按用户后续授权完成本地审查、提交和 PR 交付准备。通过 code-review 技能的两名独立审查 Agent 分别检查 Standards、Spec。使用既有 GitHub Issue #85 和当前 OctoSpec 作为需求来源，无需另建 issue tracker 配置。

先将分支更新到 main@318b0f22db5e45e6effe3b35c89bc7ef426127f9，包含 Windows 日志排空修复；审查基准固定为该 SHA，命令为 git diff 318b0f22db5e45e6effe3b35c89bc7ef426127f9...HEAD。初审实现提交为 25aa690；修复同时检查工作区 diff。交付分支改为 fix/85-provider-decoupling，遵循 CONTRIBUTING.md 的分支前缀。

## Standards

发现 1 项 P3，已修复并复审通过。adapter-metadata.md 的 CLI 帮助小节仍称 extra_adapters.json 自动追加待实施，与同文件新的统一 manifest 规则冲突。已改为 Home/manifest.json 扩展已实现，仅保留公开 /adapter SDK 的独立待办。

未发现需报告的代码异味。原生 SDK 装配、生产依赖归属、IPC 消息分流与 Windows EOF 清理所有权符合仓库规范。新增超时修复的中文注释、公开选项说明与实现一致。

## Spec

发现 1 项 P2，已修复并复审通过。spawnWorker 新增的 IPC 快照发送原先在 waitForReady 之前等待 child.send 回调。子进程启动即阻塞且快照触发 IPC 背压时，就绪超时及取消尚未开始，初始化持续挂起，进程所有权也尚未登记。

已先登记 onSpawn，再让快照发送与首次 list RPC 共用一个受超时和 AbortSignal 约束的初始化 Promise。失败继续执行现有进程回收；迟到的回调拒绝由已有 Promise 处理器消费，不新增未处理拒绝。保留内部 worker 协议、SDK 原生装配和 Windows 关闭路径。

新增两个 8 MB 快照回归，模拟子进程事件循环无法读取 IPC：一个触发就绪超时，另一个触发取消，均在约 150 ms 内拒绝并确认登记的进程已退出。专项 module-loading、component-startup、host-process-close 回归 14 通过、22 Windows 平台项跳过、0 失败。两名 Agent 已分别复审修复并确认没有剩余实质问题。

可选补充不作为阻塞项：原 Issue 的 OpenClaw/Codex/Claude Code 实际包三项子集 fixture 未单独建立；按用户澄清后的 A13 使用包外 fake Provider 证明选择、调用和清理，同时用实际 tgz 验证完整默认目录。未运行真实 Provider 探测或业务 FDE 交付验收。

## 交付边界

最新 main 基线及修复后的完整回归：UI 35 通过；Node 1481 项中 1449 通过、32 按平台跳过、0 失败。额外 22 个跳过项来自最新 main 的 Windows 专项。类型/构建、lint、命名、格式、双语文档和四项示例行为检查通过。OctoSpec 检查仍仅有 main 基线的根 docs 目录规则冲突。

用户已授权提交、推送、创建 PR 并合入 main，未授权 npm 发布。main 当前保护要求 CI Gate 成功且至少一个其他账号批准，并对管理员生效；仓库未启用自动合并。交付须遵守这些保护，不绕过审批或修改仓库设置。实际 PR、CI 和合并状态由 GitHub 记录确认。

审查统计：Standards 1 项 P3、Spec 1 项 P2，均已修复并复审通过，无剩余阻塞发现。
