---
type: Journal
title: Issue 103 OpenCode 2 调研记录
description: npm 2.1.3、固定上游源码及本仓缺口核对，V1 明确报错合同与后续验收计划。
tags: [adapter, protocol, testing, invocation]
timestamp: 2026-10-23T00:00:00Z
---

# 本轮结果

后续实施已完成：最低支持版本确定为 2.1.3，旧 nvm 全局 V1 已按用户要求卸载。CLI/ACP 的 16 个真实 DeepSeek 场景、真实测试 IM 往返及独立 V1 二进制拒绝均通过；最终回归与双轴审查见 [验收记录](../../tasks/103-opencode-v2/validation.md)及 [review](../../tasks/103-opencode-v2/review.md)。下文保留最初调研时的状态，候选版本与待验表述不代表最终支持合同。

从最新 `origin/main@445d2bb` 建立 `research/103-opencode-v2` 独立 worktree。按用户要求先调研，创建 [任务简报](../../tasks/103-opencode-v2/brief.md)、[官方资料与源码对照](../../tasks/103-opencode-v2/reference.md)、[实施与验收矩阵](../../tasks/103-opencode-v2/validation-plan.md)。

用户确认 OpenCode 1 应直接报 error，不再支持。probe 与直接 invoke、ask/full_access、自定义 executable 都纳入版本门禁计划。未知版本或检测失败不能当作支持。

确认 npm 的 `@opencode/cli latest=2.1.3`，且有对应 v2.1.3 tag；旧 `opencode-ai latest=1.19.4` 和 GitHub releases 列表不能代表 V2 发布状态。初次仅查 release 列表的疑问已按 npm 证据纠正。

用户随后确认本机已升级，复核交互式 shell 及绝对路径 `/Users/lvsijia/.opencode/bin/opencode --version` 均返回 `opencode v2.1.3`。此前 Agent 非交互环境选中 nvm 目录保留的 1.18.30，两者同时存在。后续 V2 验证固定新路径，旧路径保留为 V1 拒绝样本，不将 PATH 差异误判成用户未升级。

源码确认 CLI 独立 `--variant` 与 V2 模型引用不一致；本仓还存在 ACP 本轮 inline 环境配置被固定覆盖、CLI buildCommand 中途失败可漏删临时目录等缺口。V2 原生 permissions/MCP、CLI standalone、ACP 历史重放与 effort、usage 需要逐项适配和实测。

当前建议保留两传输验证，最低候选 2.0.0、最新稳定 2.1.3；全部真实验收仍为待验，不能宣称 V2 兼容已完成。

## 验证边界

已执行 issue/网页/registry/固定源码读取和本机两个 executable 的版本查询。用户已安装 V2，本轮未安装或覆盖 Provider；未进行 Runtime 调用或真实模型/工具/审批测试，未修改产品实现。

最初 `python3 .octospec/scripts/lint.py` 因当前 Python 缺少 PyYAML 无法启动；改用 `uv run --with pyyaml python .octospec/scripts/lint.py` 后，仅报告以下 3 个基线已有文件缺少 frontmatter，已通过 `git show HEAD:<path>` 确认，不属于本次变更：

- `.octospec/tasks/systemd-directive-paths/brief.md`
- `.octospec/tasks/systemd-directive-paths/review.md`
- `.octospec/journal/shared/2026-10-22-systemd-directive-paths.md`

本次 4 个新增 OKF 文档及 context.yaml 的 YAML/必需元数据检查通过；全量检查未报告新增文件或链接错误，`git diff --check` 通过。没有提交、推送、PR 或发布操作。
