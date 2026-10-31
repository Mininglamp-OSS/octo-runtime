---
name: octospec-workflow
description: 在本仓实现功能、修复缺陷或修改关键合同时，按规划、实现、验证、收尾维护工程知识；简单文档或格式改动直接处理。
---

# octo-spec 中文工作流

1. 规划：读现有代码及 `.octospec/rules/_index.yaml`，用 `.octospec/tasks/_brief.template.md` 建立任务简报，记录目标、关键合同、范围及验收。已有明确需求按用户授权执行；关键决策缺失时再询问。
2. 实现：按路径或标签读取命中的规则全文，仓库规则以同 `id` 覆盖全局规则；将实际读取清单写入任务的 `context.yaml`。遵循架构边界完成改动。
3. 验证：对照规则和验收检查 diff，运行改动所需的检查；真实接口使用线上测试环境，证据不得含凭据。失败时修复并重验受影响项。
4. 收尾：将结果与实际证据写入 `journal/shared/<slug>.md`，声明 `type: Journal`；更新 `log.md`。可复用结论直接回写规则及索引，只有未决项放入 `learnings/pending/`。已通过且未变化的检查无需重复。按用户授权提交、推送或创建 MR。

所有说明使用中文。真实运行状态与设计目标分开记录，不把未执行的验证写成通过。

## YAML 元数据强制要求

- 在 `.octospec/{rules,guides,tasks,journal,learnings}/` 下新建或修改知识 Markdown 时，文件开头必须有完整的 YAML frontmatter（以 `---` 开始和结束），且解析结果必须为 mapping。已有文件缺少时，必须在本次编辑中补齐，不能只依赖模板或正文标题。
- 必填字段为 `type`、`title`、`description`、`tags`；前三项必须为非空字符串，`tags` 为列表，无标签时写 `[]`。保留已有有效元数据，规则文件另须满足规则索引要求。
- `brief.md` 使用 `type: Task`，`review.md` 使用 `type: Review`，`validation.md` 使用 `type: Validation`，开发日志使用 `type: Journal`；规则和指南分别使用 `Rule`、`Guide`。其他知识文件按其职责及现有约定声明 `type`。
- 此要求适用于上述目录中的知识单元；`index.md`、`log.md`、`*.template.md` 沿用当前检查器的豁免，`context.yaml` 本身是 YAML 文件，不添加 Markdown frontmatter。

最小示例（根据文档职责替换字段值）：

```yaml
---
type: Validation
title: 任务验证记录
description: 记录本次改动的验证命令、结果与限制。
tags: []
---
```

交付、上传附件或宣布阶段完成前，必须检查本次新增或修改的全部知识 Markdown 的 YAML 语法及必填字段，并运行 `.octospec/scripts/lint.py`（需要 PyYAML）。发现本次文件缺失或格式错误时，必须修复后重验；全库检查中的未修改历史错误须独立列出，不得将其写成通过，也不得用历史错误替代本次文件检查。
