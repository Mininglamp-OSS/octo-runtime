---
type: Journal
title: Issue 18 直接点名后的精确会话命令
description: reset/new/stop 的实现、最新 main 基线离线验证及审查结果。
tags: [channel, session, reset, testing]
---

# 实现与代码版本

任务 [ORT-8 / Issue #18](https://github.com/Mininglamp-OSS/octo-runtime/issues/18)，规格见 [brief.md](../../tasks/18-mentioned-slash-commands/brief.md)。用户认可规格并追加 `/stop`；同时明确完整输入匹配，不能把“帮我看一下/stop为啥不生效”等语义文本当控制命令。

分支 `fix/18-mentioned-slash-commands`，主机 macOS，worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-18`。按用户再次要求 fetch 并 rebase 最新 main，固定验证基线 `a5a32835882deab5e2364b559dd06bf1675c1335`，以下结果对应此 SHA + 当前未提交修改。知识日志冲突保留主线 Issue 263 与本任务两条记录，源码恢复无冲突。恢复用 stash `f8e887580b7497715c174a010dcfe0a0d5e0bf34` 保留。未创建提交、未推送、未创建 PR，未改 Git 作者信息。

## 最终行为

- `transport/session-command.ts` 在已有准入后校验直接 UID、无广播标记、UTF-16 实体边界及连续前置提及；仅剩余输入完整等于 `/reset`、`/new`、`/stop` 才返回命令，不修改原文。
- Gateway 群/话题显式传 `sessionControl`，未匹配为 null，应用层禁止回退到裸文本控制；省略字段保持 DM 与既有内部调用行为。实体缺失/空数组只兼容有当前 UID 且无广播的裸命令。
- reset/new 复用原 reset；stop 复用现有取消入口，均绕过普通队列。语义文本按原文进入 AgentRun。广播、广播展开 UID、混合广播不能重置或停止；原有普通广播任务准入保持。
- 同步 Channel 与会话规则；专项放在 `test/manual`，不纳入默认 CI 集合。

## 验收对应关系

| 规格 | 证据 |
| --- | --- |
| A1/A3/A6/A7 | 三命令的群/话题成功回执、零工作/排队/任务/执行/准备；UTF-16 名称、空白、重复与乱序实体、裸命令、非法实体纯函数矩阵 |
| A2/A12 | reset/new 后 binding 清除、下一轮新 session/代次与固定 workdir、重投去重、重置失败无执行；在途 new 不取消、stop 取消原 invocation |
| A4/A5 | 广播 all/humans/ais、布尔和数字标记、展开 UID、混合实体及实际广播标签逐条执行；零 reset/取消，回退输入保留原文 |
| A8/A9/A10/A15 | 非文本消息不生成控制；错 Space/群/发送者/自消息/错 Bot/无提及拒绝；语义 slash、代码、参数、后置提及不命中，真实 transport 语义文本原文执行 |
| A11/A13/A14 | DM 三命令、两 Bot 目标隔离、群与话题停止空闲/在途行为；既有其他命令及队列保护由相关回归覆盖 |

## 本地验证

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 上一轮通过，锁文件及依赖清单未变，本轮未重复安装 |
| `pnpm build` | 通过；WebUI 现有 bundle 大小及 use-client 指令警告，无失败 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过；在完整 build 后执行，完成 typecheck 的同等编译检查 |
| `pnpm lint` | 通过 |
| `node scripts/lint-names.mjs --format json` | 通过，0 findings |
| `node --test test/manual/channel-mentioned-session-commands.test.mjs` | 最终 25/25 通过 |
| `node --test test/im-*.test.js test/gateway-*.test.js test/channel-*.test.js` | 590/590 通过；包含初始单独运行的 42 项，不重复累计 |
| `pnpm exec prettier --check`（本次四份 TS 与专项文件） | 通过 |
| `git diff --check` | 通过 |
| `git diff origin/main -- .github package.json pnpm-lock.yaml scripts` | 空；无新增或扩大 CI、默认测试、锁文件变更 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过：533 个 OKF 单元、20 条规则、3408 个本地文件链接 |

补测中四项曾因等待“总回复数恰好为 1”超时；先前普通执行也会回执，已改为等待具体重置成功回执，最终 25 项通过。广播矩阵改为逐条发送并等待执行完成，避免容量拒收妨碍原文回退验证。测试 Provider 使用真实消费的 `session.update` 与 final 输出，网络和 Kernel 边界为 fixture，不代表真实 IM 或 Provider 实测。

## 双轴审查

使用 `code-review` 技能，以固定基线加工作区 diff（含未跟踪文件，未授权提交）分别由独立 Standards、Spec 审查者读取。两个轴均 0 项需修复问题；Spec 复核补充的 A2、A13 与广播逐条矩阵仍无新增问题。缺少通用 issue-tracker 文档时直接使用本任务已提供的 Issue 和 brief，不另引入配置。

## 历史失败与本轮处理

上一轮基线 `0c67c256e5196b6170971cc9759d1d4bbea03017` 的全仓 Octospec lint 因以下三个文件缺 frontmatter 失败，流程退回规格审查：

- `.octospec/tasks/267-cli-help-attribution/brief.md`
- `.octospec/tasks/267-cli-help-attribution/validation.md`
- `.octospec/journal/shared/2026-11-01-267-cli-help-attribution.md`

本轮仅为这三文件补齐类型、标题、描述与标签的 frontmatter，保留正文，解除既有知识检查阻塞；使用 uv/PyYAML 隔离依赖，重跑全仓检查通过。最新 main 基线下 Standards、Spec 两轴复核均为 0 项问题，Spec 审查者另重跑专项 25/25 通过。本轮本地验证通过，进入等待验证审查。

## 未执行

未运行真实 IM 联调、真实模型、全仓 UI/Node 完整 pnpm test、托管 CI；此变更是 Gateway 内部合同，已运行 590 项相关回归。真实客户端通过本地发送代码核对报文形态，不宣称真实客户端操作验收已完成。
