---
type: Task
title: Issue 162 标准与规格双轴审查
description: 记录独立 code-review 结论、引用解析问题和复审结果。
tags: [documentation, testing, architecture]
timestamp: 2026-11-01T00:00:00+08:00
---

# 审查范围

固定基线 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，审查工作区 diff 及未跟踪的新脚本和任务文件。HEAD 与基线相同，无新增提交。按 code-review 技能由两个独立子代理并行执行标准轴与规格轴；因用户未授权提交，使用工作区内容而非空的提交间 diff。规格源为本目录 brief.md 和 #162，已有明确 issue 来源，不依赖仓库未配置的 issue-tracker 集成。

## Standards

未发现可确认的标准违规或需修复的代码异味。已核对原生服务所有权、Extra 共享四秒预算、检查脚本、开发依赖及默认入口；workflow 与默认测试范围未扩展，运行时代码仅修改注释。

审查另以慢 stderr 消费者验证聚合输出，10000 条检查错误完整输出。脚本使用自然退出和 `process.exitCode`，不以立即 `process.exit` 截断管道。

## Spec

初审发现 1 项 medium：未定义引用仅在单个 text AST 节点内匹配，会漏掉 `word[bad][missing]` 和 `[**bad**][missing]`，违反「未解析引用均报告失败」。

修复为在 paragraph、heading、tableCell 的 AST 边界内识别完整/折叠引用，屏蔽代码、HTML 和已解析链接，保持 UTF-16 原始偏移并处理转义和嵌套括号。新增相邻文字、格式化/嵌套标签、代码标签、图片和 Emoji 场景；错误按源行排序。复审独立重跑 11 项手动回归，全部通过，原问题关闭，未发现新增实质性规格偏差。

另补强临时 CLI 夹具：仅提供 Markdown/HTML 解析所需依赖，故意不提供 Runtime 包；显式模式仍成功，默认模式报告缺少 Runtime 模块。这样即使本仓库已经构建，也能持续验证手动模式没有 Runtime 构建依赖。路径边界夹具明确使用与仓库同前缀的相邻路径。

## 结论与边界

标准轴 0 项；规格轴原 1 项已修复，剩余 0 项。审查与运行均在 macOS，未验证 Windows 原生符号链接权限或真实 Provider/IM。首轮全库 OKF 的四项基线失败已按用户要求补齐元信息并复跑通过，见 validation.md。

补齐元信息后再次进行双轴增量复核，标准轴与规格轴均为 0 项。两位审查者逐字比较四份历史记录，确认仅新增 frontmatter，正文与基线一致；规格审查者独立复跑全库 OKF，通过 524 个单元、20 条规则、3386 个本地链接。默认 scripts 与 workflow 均无范围变化。
