---
type: Journal
title: Issue 85：双模式 Adapter/Extra 装配实施
description: 规划后授权实施，记录 SDK 原生导入、CLI 双清单、依赖闭包和发行验证。
tags: [architecture, adapter, extra, testing]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 实施记录

接续[规划记录](2026-10-21-provider-decoupling-plan.md)，用户授权在 spec/85-provider-decoupling worktree 实施，并再次明确 SDK 必须原生 import，不接受外部 Node 顶层服务装配器。

本次完成框架生产依赖中立、CLI 唯一默认 manifest 与 Home 扩展、逐项来源锚点、内部 worker 启动快照和 Extra 按需加载；SDK 保留调用进程直接创建 Kernel/Extra 的原生路径。双语 docs 和整体架构约束同步。

构建、类型、lint、名称检查、全量测试、双语与示例检查通过；实际 tgz 仓库外离线安装及默认全量目录验证通过。Node 回归 1447 通过、10 跳过，UI 35 通过。OctoSpec checker 仍有禁止根 docs 的已知 main 基线冲突。验收矩阵和未覆盖范围见[实施记录](../../tasks/85-provider-decoupling/implementation.md)。

未提交、推送、创建 PR 或发布，未自动修改用户 Home。

以上为首次实施阶段记录。后续已按授权提交并创建 [PR 91](https://github.com/Mininglamp-OSS/octo-runtime/pull/91)。远端审查发现旧 manifest 省略 type 时 OpenClaw 初始化遗漏，以及具体依赖归属说明过时；本轮已修复并完成本地双轴复审。UI 35 通过，Node 1452 通过、32 平台跳过，详细机制、回归与合并保护边界见[审查记录](../../tasks/85-provider-decoupling/review.md)。尚未发布 npm。
