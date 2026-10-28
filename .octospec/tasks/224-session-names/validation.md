---
type: Task
title: Issue 224 验证记录
description: 离线回归、原生会话记忆和未完成的真实 IM 验收分别记录。
tags: [session, testing, openclaw]
---

# 环境与范围

执行者 Codex，2026-10-28，macOS arm64，Node v24.19.0，pnpm 11.19.0。实施基线 `0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，新 worktree `octo-runtime-issue-224`，分支 `feat/224-session-names`。以下原生验证针对本任务 dirty 实现；最终提交 SHA 由 PR 提交列表及审查记录固定。未合并、未部署。

规划准备度 96/100，见[评估](assessment.md)，不表示测试通过。读入规则清单见[context.yaml](context.yaml)。

# 独立 Non-gating Live Acceptance

手动执行 `node .octospec/tasks/224-session-names/verify-provider-live.mjs <provider>`，不接入默认测试或 GitHub status。只创建本次 QA 会话，禁止工具及消息发送；后两轮输入不含标记或历史文本，验证 Provider 自身记忆，不仅检查回执。

| Provider / 实际版本 | 三轮句柄 | 后两轮记忆 | 新逻辑会话 | 结论 |
| --- | --- | --- | --- | --- |
| OpenClaw 2026.9.4 / Gateway v4 | `agent:main:octo-dm-qa224-67988b3a-5866-4f4e-bf3e-a48e0ecff6c5-c1cfaa1b-9a1c-42cc-98db-e2ad533cb8a1` 保持 | 2/2 返回合成 marker | 同名另建独立 key，合计 2 次 create、2 次 describe、4 次 agent | PASS |
| Codex 0.164.0 app-server | `01a18220-ec1e-7ad0-837b-ade360bbb88f` 保持 | 2/2 返回合成 marker | 新句柄 `01a18221-223e-72f2-8703-3d8e5f2b0756`，只在两次 fresh 请求 thread/name/set | PASS |
| Claude Code 2.1.306 | `6656916a-a9c6-4f9f-8fb5-2c5061c27dd8` 保持 | 2/2 返回合成 marker | 新句柄 `44eea011-7cc8-497f-9da4-6d6e57b86bf0` | PASS |

OpenClaw 对不存在 key 的额外真实请求返回 `OPENCLAW_SESSION_NOT_FOUND`；create/agent 总数未增加，不做 fresh fallback。使用本机已运行 Gateway 与临时设备身份，不改 Gateway 配置或已有会话。保留 QA 原生会话作为审查证据，未删除用户会话；本次临时工作目录已清理。

Codex 的两条 QA 原生 session_index 记录均持久化了调用方 thread_name；CC 的两份 QA transcript 均持久化了 custom-title。只读取本轮 QA 会话，不记录凭据或其他用户对话。OpenClaw 名称直接出现在上述原生 key 中。

真实验证修正过两点：Gateway 9.4 不广告 sessions.resolve，改用已广告且源码确认只读的 sessions.describe；CC partial 模式的 final 文本来自 message.delta，验收脚本最初只收 message.update，修正后重新完成全部四轮。初次失败不计为通过。

真实 IM：**BLOCKED**。显式运行 `verify-im-live.mjs`，指定受保护 QA 账号文件中的 token 为占位值，未通过测试凭据检查；`octo-cli auth list` 返回 0 profiles。尚未发送 QA IM、创建话题或连接 Bot；DM/群/话题真实 Kernel→Provider→IM 回读没有执行，不能由上述 Provider 直连结果推定通过。脚本保留供有真实测试凭据时手动运行。

通用 ACP 的名称未应用及 session/load/new 为离线合同回归；本轮没有真实 ACP agent 验收。CodeBuddy/Grok/其他 Adapter 不新增标题映射，限制在双语文档的能力表明示。

# 源码与离线检查

27 个固定 OpenClaw commit 来自既有 Issue 40 版本表；`extract-resume-contracts.mjs` 通过 TS AST 生成严格请求字段子集，包括 describe 与两套 patch 字段，各版本 commit、路径及 SHA-256 在 `test-support/openclaw-resume-contracts.json`。不是 27 个真实 Gateway 验收。

初轮全量 2332 项：2234 通过、7 失败、91 跳过。其中 4 项是随机默认名称导致旧 parity 测试比较两次独立 UUID，已改为明确传名称以验证透传；2 项为新增 OpenClaw fixture 断言，已修正；1 项是已有未修改的 verification-command 测试误找到 Node 目录中的全局 octo-cli。本机复制同版本 Node 到无 octo-cli 的隔离目录，单项 8 通过、10 平台跳过，未改产品或该测试。

上述 6 项相关专项重跑 184/184 通过。随后全量 Node 2333 项中 2242 通过、91 平台/环境跳过、0 失败，WebUI 35 项通过；使用同版本隔离 Node 避免全局 octo-cli 污染既有缺失命令测试。此后新增名称边界和 legacy binding 回归分别经 38/38、17/17 专项通过。

`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm docs:check`、`pnpm lint:names`、`pnpm native:check` 通过。知识库 lint 使用临时 PyYAML 环境通过。首次 native:test 因缺少 Python venv 未执行 Python，用 `uv sync` 建好原生工程环境后重跑；最终原生结果、同步 main 后回归与双轴审查另行补充。

CI 范围约束：没有修改 workflow/job/matrix/trigger/gate，也没有默认开启真实专项。提交及 PR 前再次核对相对 main 的 workflow diff 与实际检查列表。
