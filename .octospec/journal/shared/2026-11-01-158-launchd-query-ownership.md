---
type: Journal
title: launchd 查询失败保留管理能力
description: Issue 158 本地实现与原生停止卸载验收。
tags: [runtime, lifecycle, testing]
---

# 本轮结果

launchd 服务查询集中识别明确缺失，其余非零结果传播；print-disabled 失败不再伪造启用。停止与卸载未确认 job 消失时保留 plist，CLI 错误快照显示服务和自启 unknown。相关回归 84 通过/13 Windows 条件跳过，手动专项 22 通过，原生 macOS 专项 1 通过。构建、类型、lint 和命名检查通过；双轴审查首轮发现的测试清理异常覆盖问题已修复，最终无未解决项。

源版本、逐项验收、命令、原生 label/PID 和清理边界见 [验证记录](../../tasks/158-launchd-query-ownership/validation.md)。严格缺失签名和公共 JSON 兼容选择见 [brief](../../tasks/158-launchd-query-ownership/brief.md)。

新增专项仅显式本地执行，CI 范围不变。当前为基线 `a5a32835882deab5e2364b559dd06bf1675c1335` 上的未提交改动，未推送、创建 PR 或部署；等待验证审查。真实权限拒绝与跨 macOS 版本未测，原生 enabled override 历史记录仍保留，job/进程/定义已清理。

用户后续授权更新主线并提交 PR：已 rebase 至 `main@c35b261b`，保留日志冲突双方内容，实现字节不变。复验构建/类型、lint/命名、84 项相关回归、22 项专项和 1 项原生测试均通过。实现已提交，后续推送及 PR 引用以 Loop 结果评论为准，不自动合并。
