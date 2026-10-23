---
type: Task
title: Issue 16：MiMo Code ACP Adapter
description: 复用共享 ACP 适配 MiMo Code，记录验收及上游问题。
tags: [adapter, testing]
timestamp: 2026-10-23T00:00:00Z
---

# Issue 16：MiMo Code ACP Adapter

## 目标与归属

用户要求在新 worktree 处理 #16，直接采用与其他 ACP 类型一致的实现。初始基线为 `origin/main@445d2bb`，分支 `codex/issue-16-mimo-code`，已按用户要求 rebase 到最新 `origin/main@cc49c8b`。

MiMo Code 执行协议属于 Runtime Provider 适配职责。新增 `mimo-code` 薄封装，逐轮启动 `mimo acp`，复用共享 ACP 的 Context、交互、模型选择、事件映射、取消与清理。宿主拥有安装、认证、配置来源、业务历史、会话及 Gateway 准入；不新增 Provider 专属渠道逻辑，不改变默认 Provider 优先级。

SDK 在内部 worker 原生 import 并注册 Adapter；CLI 通过自身默认 manifest 装配。Kernel 与 Extra 仍由各自宿主直接构造；Provider 进程属于单次 ACP 调用，不新增顶层服务或资源管理实现。可执行路径通过工厂现有 command 选项覆盖。框架不读取 MiMo 凭据、不安装 CLI、不重置 Home。

## 范围与验收

- 包、CLI 默认目录、依赖闭包、发行包验证与双语用法。
- 使用标准 ACP fixture 验证命令、环境、session/new/load、模型、流式结果、故障、取消及复用；共享 ACP 回归保留。
- 上游固定参考为 v0.1.15，源码 `packages/opencode/src/cli/cmd/acp.ts` 定义 acp 子命令及进程内 HTTP shim。
- 真实 SDK/CLI 模型、IM 私聊及群 @、工具、认证、取消与平台验收分别记录。未运行的场景不算通过。初查时执行命令的 PATH 未找到 mimo；后续已定位 `~/.mimocode/bin/mimo`，确认版本 0.1.15、acp 帮助正常，不再将 PATH 检测失败表述为未安装。
- 最终真实验收阻塞：MiMo 0.1.15 先返回 prompt 完成、再发送末尾正文；审查后移除无法证明完整性的定时等待实验，保留标准 ACP 封装。私聊使用浏览器中已登录的人类账号发起，已触发真实 Gateway 并观察到截断回复。用户明确选择仅保留 Runtime 变更、等待上游修复，随后授权先提交 PR；PR 须明确当前限制，复验通过前不合并。

不通过新增认证检查、能力目录、业务历史缓存或权限兜底来补造上游行为。Provider 真实兼容性及内部 HTTP 服务收尾须由真实版本验证，不由 fixture 推断。
