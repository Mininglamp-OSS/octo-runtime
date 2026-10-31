---
type: Task
title: Issue 267 实现与本地验证
description: 根帮助署名改动的既有验证证据与限制。
tags: [cli, testing]
---

# #267 实现与本地验证

## 代码与范围

- 执行编号：ORT-85-implement-20261101-01；本地日期：2026-11-01。
- 基线与 HEAD：`0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，工作区 dirty，未提交、未推送。
- 分支：`feat/267-cli-help-attribution`；平台：Darwin arm64；Node.js：v24.22.2；pnpm：11.19.0。
- `apps/cli/src/command-tree.ts`：仅在根 description 的原文后加入两行署名和 URL。
- `test/cli-help.test.js`：既有根帮助用例增加精确文案、独立行唯一性、位置和空 stderr 断言。
- 上述两文件相对基线的 `git diff` SHA-256：`48e09cdca9ac86f86786dcc90922eea92c48c5fb732f7abb8d75db3948ede112`。
- 新增/更新本任务 brief、context、验证记录和 journal；无 CI、依赖、锁文件或脚本改动。

## 本地结果

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，prepare 构建通过，锁文件无变化。 |
| `pnpm typecheck` | 通过，包含 workspace 构建与根类型检查。 |
| `pnpm lint`（构建结束后） | 通过。 |
| `pnpm exec prettier --check apps/cli/src/command-tree.ts test/cli-help.test.js` | 通过。 |
| `node --test test/cli-help.test.js` | 14 通过，0 失败、跳过或取消。 |
| `node /tmp/ort85-help-check.mjs` | 通过；本机临时脚本用于下列真实进程断言，不加入默认测试或 CI。 |
| `git diff --check` | 通过；新增 Markdown/YAML 同时单独检查空白。 |
| `git diff <基线> -- .github/workflows package.json pnpm-lock.yaml` | 空；全部实际代码 diff 只包含上述文案及断言。 |

首次 lint 与 `pnpm typecheck` 并行执行，构建会先清理 dist，lint 报 465 个无法解析类型相关错误；构建结束后原命令重跑通过，没有为消除此类错误改动代码。

首次真实进程检查未显式传 manifest，源码 worktree 的默认全局发现路径按既有行为向 stderr 输出 discovery 提示；随后按规格的“相同 Home/manifest”条件显式使用构建产物 manifest。临时脚本也将错误的非法参数预期调整为仓库现有合同（退出码 2、`INVALID_ARGUMENTS`）。以上为验收脚本准备修正，产品代码未增加规避逻辑。

## 实际输出与验收对应

临时脚本使用 `mkdtemp` 创建独立 Home，调用结束后回收；通过 `spawnSync` 捕获 stdout、stderr 和退出码，超时 10 秒。子进程移除 `OCTO_*` 环境变量，设置 `NO_COLOR=1 TERM=dumb`，显式传 `--manifest <worktree>/apps/cli/dist/manifest.json`。可复用的单次命令形状：

```sh
NO_COLOR=1 TERM=dumb node apps/cli/dist/index.js --home <临时Home> --manifest apps/cli/dist/manifest.json --help
```

同一构建的输出开头：

```text
Octo Runtime CLI (0.0.0)
commit:0bcd89c52801 (dirty)
build:2026-10-31T17:06:02.241Z

Manage the local Octo Agent runtime and independent services.

Octo Runtime by Mininglamp Technology
Open source on GitHub: https://github.com/Mininglamp-OSS/octo-runtime

Usage:
  octo-runtime [options] [command]
```

- AC1：`--help`、`-h`、`help`、无参数的 stdout 完全一致，退出码均为 0，stderr 为空；两行精确文案各出现一次。
- AC2：完整 stdout 没有 ESC 字符，URL 在一个独立行中连续完整，人工检查布局清晰。
- AC3：版本、commit、build、原描述、Usage、Examples、Available Commands、Flags 保留；新增块位置由断言核对，命令排序由原测试核对。
- AC4：真实进程的 `version`/`--version`/`-v` 输出一致且不含新增署名，`executor-kernel --help` 成功且无新增块；非法选项退出 2、stderr 含 `INVALID_ARGUMENTS`。14 项既有帮助回归覆盖动态子命令、参数验证和模块隔离等合同。
- AC5：新增内容为本地静态字符串，没有新增网络或认证依赖；真实进程在无 Octo 凭据环境下完成。没有执行操作系统级断网，不宣称已经完成该项实验。
- AC6：workflow、package scripts、锁文件和默认开关无变化，未新增 job、矩阵、触发、必需状态或 CI gate。

## Standards

按 `code-review` 技能由独立 Standards agent 审查基线到当前工作区的 diff，以及本任务规格。无新提交，故使用 `git diff <基线> -- <文件>`，不使用空的提交间 diff。仓库规则、CONTRIBUTING 和用户 OSS 约定作为规范来源；明确的 Loop/GitHub 来源及本地 brief 已提供，无需另行配置 issue tracker。

未发现规范违规或需修复的代码异味。文案留在 CLI 展示层，版本头及公共协议不变；测试补充既有回归，没有依赖、脚本或 workflow 变更。此轴为静态审查，不代替运行证据。

## Spec

独立 Spec agent 对照 brief 审查，未发现缺失、错误实现或范围扩大。两行文案、纯文本 URL、布局和保留边界符合规格，运行验证结果由主执行者记录。

Standards：0 项发现；Spec：0 项发现，各轴均无最高严重问题。

## 限制与后续

本次是本地 macOS/Node 24 验证，未执行 Windows、Linux、Node 26、完整跨包测试、真实 Provider/IM 或托管 CI；该变更不涉及跨包合同。构建有既有 WebUI 打包提示（use client、较大 chunk），构建退出 0，未扩入本任务修复。

实现和适用本地验证已完成，等待用户审查验证结果。提交、推送、创建 PR 均尚未授权；当前保留未提交修改。
