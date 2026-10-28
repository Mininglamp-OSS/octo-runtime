---
type: Journal
title: PR 229 名称兼容与续聊复审修正
description: 放宽公共展示名称、限定 Gateway 展示片段，并过滤 OpenClaw 已知旧无 runId 审批。
tags: [session, review, openclaw, testing]
---

# 本轮决定

用户最终确认 `sessionName` 只限制非空白、长度及控制字符，允许 `:`、`-`、`_`、中文等。公共合同为 1–256 Unicode 码点且无 C0/DEL/C1 控制字符；合法名称原样透传。替代前日临时 ASCII 合同，名称仍归调用方，Host SDK 不增加业务命名器。

Gateway opaque 地址不能直接作为无界展示片段。各展示片段限制 80 码点、控制字符替换为 `-`，保留随机后缀；旧非法名称可补正，业务地址、session、generation 及原生恢复句柄不变。OpenClaw 完整复审另发现旧无 runId 审批串入新轮次，现过滤派发前旧审批及其重播；当前合法实时审批保留，原生缺关联字段的剩余歧义如实记录。

# 证据与范围

渠道两项与审批一项新增回归均先在旧实现失败后修复。完整本地 Node 2284 通过、91 跳过，WebUI 35 通过；Go/Python 原生套件 45 通过，各含 434 协议输入。类型、格式、lint、文档与生成检查通过。独立双轴复审各一项 P1 均关闭，详见[审查](../../tasks/224-session-names/review.md)。

OpenClaw、Codex、Claude Code 另用包含冒号/下划线/中文的名称完成真实三轮同句柄与记忆验证、同名 fresh 隔离。真实 IM、通用 ACP 及本轮真实人工审批未验；不扩大 GitHub CI 范围。旧 Ubuntu Node 26 构建超时与名称失败没有日志证据上的关联。命令、版本及边界见[验证](../../tasks/224-session-names/validation.md)。
