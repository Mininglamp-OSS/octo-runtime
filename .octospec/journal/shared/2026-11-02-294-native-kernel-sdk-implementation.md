---
type: Journal
title: Issue 294 原生 Kernel 与 CLI 实施记录
description: 记录宿主对象装配、统一 RPC、清理责任和精简 SDK 文档的实际变更及验证边界。
tags: [architecture, adapter, ipc, lifecycle, testing, documentation]
---

# 实施结论

用户在[规范阶段](2026-11-02-294-native-kernel-sdk-spec.md)后授权实施，并要求同步修复 CLI、精简 SDK 接入文档。本阶段基于同一 main SHA 与 worktree 完成未提交变更，具体命令和结果见[验证记录](../../tasks/294-native-kernel-sdk/validation.md)。

Kernel 只接收 endpoint 与宿主已构造的 Adapter 等配置值，在服务进程注册到唯一 AgentExecutor；真实 socket/pipe RPC、HostRunService、Run 身份、观察恢复和控制继续保留。删除执行 worker launcher/supervisor/runner 及 Kernel 模块 loader；CLI 自己读取 manifest、import、调用工厂和完成 OpenClaw 准备。常驻服务与 Playboard 均使用同一个原生工厂。

状态不再包含虚构的 worker generation/recovery，CLI 展示 execution_ready。Core、Run 与日志共用关闭预算，清理失败保留资源记录；资源记录中的 manifest 命名不代表 Kernel 仍读取模块 manifest。按用户最终决定，旧 WorkerRpc、心跳及 worker 身份回收实现全部删除，不提供兼容或升级。旧格式明确拒绝并保留原文件；原生 owner 异常退出的资源确认不杀宿主、不伪造成功。

双语 SDK 页改为 API 用途/签名表和具体调用例子；不规定唯一加载方式，仅一句建议 pnpm workspace + Git submodule。CLI 运维、排障、模块加载、架构和相关 README 与实现对齐，不维护签名迁移表。当前规则正文集中在 `.octospec/rules/`；历史 worker 的执行证据留在各自历史任务。

PR #295 后续评审指出该 GUI Provider 在 Electron 中依赖旧 worker 的 Node 模式环境。用户明确该接入基于逆向方案，应彻底移除；本轮删除整个 Adapter、注册、依赖、UI 图标、专属 fixture/测试及当前双语文档。内置具体 Adapter 为 13 个，8 个专用工厂和 5 个默认 ACP 实例。相关历史说明、源码链接和使用示例也按用户要求删除。Playboard 装配取消建议未获本轮实施授权，继续保持未修复事实。

默认回归、类型与 lint、双语文档、Go/Python RPC 客户端验证已通过。本地 tgz 的离线安装、独立工程公开 SDK/示例、原生 Kernel/Extra、CLI 前台服务及卸载保留 Home 检查通过；OKF 检查通过。真实 Electron、Provider、线上 IM 和 Windows/Linux 原生平台未运行。未扩大 GitHub CI，未提交、推送、创建 PR 或发布。

用户后续要求本地审查并细分 SDK 文档。双轴 review 复现并修复两项 P2：真实在途 probe 未纳入关闭等待，以及活宿主掩盖实际清理失败。回归后 Node 2370 通过、69 跳过、0 失败，WebUI 35 通过。SDK 服务接入、高级依赖、可选 AgentRun 使用分别成页；显式 attachKernel 归 CLI 模式跨进程接入说明。CLI Gateway 仍由 ExtraService 内部 attach 已有 Kernel。详细发现、修复和验证波动见任务 review/validation。
