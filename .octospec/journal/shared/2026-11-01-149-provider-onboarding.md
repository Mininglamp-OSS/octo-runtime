---
type: Journal
title: Issue 149 Provider 文档所有权对齐
description: 记录文档修正及与实际执行合同对应的本地证据。
tags: [documentation, adapter]
timestamp: 2026-11-01T00:00:00Z
---

# 本轮结论

用户追加授权修复格式问题、commit 和创建 PR 后，已同步到 `a5a32835`，复用上游 #270 对原四处格式问题的修复；本轮另外补齐 #267 三份文档的 frontmatter，保留历史正文。新基线构建、文档执行示例 4 项、专项 88 通过/1 条件跳过、30 个 README 片段与 Core 连续性校验均重跑通过；全仓 OKF 535 个单元、20 条规则、3437 个链接通过。双轴复核各 0 项；首轮阻塞已解除，按授权提交 PR，不自动合并。

## PR 同步 main

再次同步至 `7fd022cd`，两处协议说明冲突采用上游更完整的公共/内部字段说明。修复审查指出的版本计数歧义：validation 现按 `338c0e47`、`76ac6856` 和本轮合并工作区分别列出基线与计数。本轮 docs:check 4 项通过，OKF 545 单元、20 规则、3462 链接通过。相对 main 不包含 Gateway 实现，仅文档及一条注释；CI、依赖无差异。未重跑构建及全量测试。

按用户授权合入 `8510fc9b`。三处 #267 frontmatter 冲突采用 main 版本，历史正文未改，这三份文件不再计入 PR 相对 main 的变更。文档检查（4 项）、全仓 OKF（537 单元、20 规则、3442 链接）和 whitespace 检查通过；无未解决冲突，相对 main 的 workflow、依赖及 lockfile diff 为空。上游 Channel 行为沿用其合入结果，本轮未重跑构建与全量测试。

## 首轮历史

在 `0bcd89c5` 基线按用户限定，仅修正文档与一条会话注释。双语 Codex/Claude README 说明审批/推理默认值、完整 binding 保存与回传，以及 POSIX、Windows、注入 child 的清理边界。公共输入参考明确旧字段拒绝；Adapter 开发与 Provider 指南修正直接子进程、公共模式字段和每轮新建会话的旧说法。

复核结论：`createProcessCleanup` 支持可选 Windows processTree，不表示 Codex/Claude 的调用路径已启用；默认 POSIX 自有组清理不能推广到注入 child。Core 不保存业务到 Provider 的持久绑定，Provider session 更新由调用方保存；图片适配成功也不证明真实模型支持。

构建和 docs:check 通过，六个既有专项 88 通过、1 真实模型条件跳过；30 个 README 输入片段及实际 Core fresh/fresh/continue 受控校验通过。全仓 OKF lint 仍有四个基线 frontmatter 问题，新增文件定向校验单独记录。未运行跨平台真机或真实 Provider，不扩大 CI，未提交或推送。

逐项验收、源码版本和未验边界见[验证](../../tasks/149-provider-onboarding/validation.md)，双轴审查及修复见[审查](../../tasks/149-provider-onboarding/review.md)。
