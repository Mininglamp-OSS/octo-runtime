---
type: Journal
title: "Issue 263：七天执行预算的本地交付"
description: "默认 24 小时、最大七天的实现、独立监督、验证与交付限制。"
tags: [invoke, protocol, testing]
timestamp: 2026-11-01T00:00:00Z
---

# 实现与证据

按用户确认将公共单次调用默认设为 24 小时、最大七天；保留首帧、模型空闲和工具空闲检测。Context/InvokeInput、Core 与 DSH 等待共用预算，公共错误详情保留长时证据；Schema 和原生客户端校验同步生成。

[本地验收](../../tasks/263-long-running-invocations/validation.md)：手动专项 13 项通过；Go/Python 各通过 434 个既有协议样例；隔离全局 octo-cli 安装影响后，全量既有 Node 测试 2389 通过、91 条件跳过，WebUI 测试也通过；构建、类型、lint、命名、文档与生成检查通过。真实 DSH rc.4 短调用、恢复、工具、取消、失败传播及清理通过。

[双轴审查](../../tasks/263-long-running-invocations/review.md)：Standards 0 项；Spec 一项“越界不启动 Provider”证据缺口已补齐并复核，剩余 0 项。按用户补充要求，仅补齐四份已有文档 frontmatter，全仓 OKF 检查通过。

GitHub CI 及默认测试范围未扩大。代码保留在原 worktree 的未提交变更，未推送、未创建 PR、未发布。外部桌面/im-test 接入及真实 72 小时运行未验，不将本地结果视为外部宿主已升级。
