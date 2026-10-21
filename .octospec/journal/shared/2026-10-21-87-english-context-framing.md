---
type: Journal
title: Issue 87 Context 英文固定格式交付
description: 记录共享 renderer 的英文格式、多语言保留、迁移说明及实际验证边界。
tags: [context, model-input, testing]
---

# 实施结果

基于当前 octo-runtime 仓库最新 `origin/main@d064cfe` 建立独立 worktree `octo-runtime-issue-87`，分支 `feat/87-english-context-framing`。先完成 [OctoSpec 简报](../../tasks/87-english-context-framing/brief.md) 和 [98/100 可执行性评估](../../tasks/87-english-context-framing/assessment.md)，再修改实现。

唯一共享 `renderModelContexts` 的固定开始/结束边界使用英文，guidance/payload 标签改为 `Guidance:` / `Data:`。保留业务多语言值、Context v3 结构、item 顺序、白名单过滤、递归排序序列化、空 guidance 行省略、非 XML 转义及独立控制通道；没有 Schema、依赖或锁文件变更。

权威 [Context 输入合同](../../rules/context-input.md)、protocol README 和 mention 指引同步；完整格式示例保留中日文业务值，英文迁移说明要求依赖旧固定文本的集成更新解析器、断言及提示词快照。

## 实际验证

环境：macOS，Node 24.19.0，pnpm 11.19.0。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，锁文件无变化；随后显式构建 |
| `pnpm typecheck` | 通过，包含全仓构建和类型检查 |
| `pnpm lint` / `pnpm lint:names` | 通过 |
| `pnpm format:check` | 通过 |
| `pnpm docs:check` | 通过，公开 SDK 示例及文档测试 4 项通过 |
| `pnpm test:suites` | UI 35 通过；Node 1439 通过、10 跳过、0 失败 |
| 旧中文边界及标签全仓扫描 | 无残留 |
| `git diff --check` | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 唯一错误：`已退出的文档目录仍存在: docs`；原始 main 同命令复现，属于基线检查与既有双语 docs 目录的冲突。其余 OKF/frontmatter、索引和本地链接无报错 |

Renderer 精确输出测试覆盖中英日混合 guidance、payload、换行和特殊字符，嵌套对象键排序、数组及 item 顺序，缺省/空 guidance、空 Context 和非注入配置。run 编译精确断言覆盖英文边界及多语言正文，独立控制指令不混入普通内容。Core 的 native/canonical 测试覆盖输入冻结、主输入及显式 fresh fallback 的文本/图片 parts，仍只注入一次。

## 边界

没有调用真实 Provider、IM 或外部宿主；固定输出合同用 fake Provider 验证，不将其描述为模型语言遵循率或外部集成已完成迁移。原始 main 的 OKF 目录检查冲突本轮不修改。GitHub CI 状态以 PR 实际检查结果为准。
