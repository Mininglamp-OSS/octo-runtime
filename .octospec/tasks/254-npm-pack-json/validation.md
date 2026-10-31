---
type: Task
title: Issue 254 实现与验证记录
description: npm 12 真实打包、手动回归、发行验收与既有文档检查失败的证据。
tags: [packaging, testing]
---

# 实现完成，功能与发行验证通过

执行：`ORT-80-implement-20261031T180925Z`。本地功能、构建、类型、lint 与发行验收均通过；全仓 OKF 检查因基线既有 3 份文档缺少 frontmatter 失败。用户明确要求修正原结论、按成功进入验证审查并开启 create-pr；这些基线文档问题作为已接受的已知问题记录，不阻塞本次修复交付，也不将全仓 OKF 检查描述为通过。

## 代码与环境

- 用户要求更新最新 main 后开始实现，已快进至 `a5a32835882deab5e2364b559dd06bf1675c1335`。
- 分支 `fix/254-npm-pack-json`，worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-254`；下列实测对应提交前的 dirty 工作区。后续用户已授权提交、推送和 PR，交付版本在 Loop 结果评论及 PR 中记录。
- macOS arm64；Node `v24.22.2`；`corepack pnpm` `11.19.0`；实际 npm CLI `12.2.1`，位于当前 Node 安装的 `lib/node_modules/npm/bin/npm-cli.js`。
- `scripts/pack-release.mjs` 用解析 helper 替代 `[0]`，仍先执行 npm 命令，再解析并运行原数量检查与路径输出。
- `scripts/parse-npm-pack-result.mjs` 完成两种结构的显式身份选择、缺失/重复/格式诊断、filename 与 bundled 校验。
- `test/manual/npm-pack-json.test.mjs` 仅显式手动运行，含真实脚本入口的最小物料 fixture；不匹配默认测试通配符。

## 命令与结果

| 命令或检查 | 结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --ignore-scripts` | 通过，pnpm 11.19.0，锁文件无变化 |
| `corepack pnpm typecheck` | 通过，内含完整 `pnpm build` 和根类型检查；不另重复构建 |
| `node --test test/manual/npm-pack-json.test.mjs test/release-manifest.test.js` | 63 项通过，0 失败/跳过/取消；专项含 60 项，既有发行清单测试 3 项 |
| `node scripts/pack-release.mjs` | npm 12.2.1 真实打包退出 0，stdout 为归档绝对路径 |
| npm 对归档执行 `pack --dry-run --json --ignore-scripts --offline` | 返回按包名索引的对象，目标键为根包名，filename 正确，bundled 长度 68 |
| tar 列表与归档 package.json 检查 | 68 个声明的 bundled 包均具有归档内 package.json，缺失集合为空 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit a5a32835882deab5e2364b559dd06bf1675c1335` | 全部现有发行检查通过，退出 0 |
| `corepack pnpm lint` | 通过 |
| `corepack pnpm exec prettier --check scripts/pack-release.mjs scripts/parse-npm-pack-result.mjs test/manual/npm-pack-json.test.mjs` | 通过 |
| `git diff --check` | 通过 |
| `git diff a5a32835882deab5e2364b559dd06bf1675c1335 -- .github/workflows package.json pnpm-lock.yaml` | 空；无 workflow、默认脚本或锁文件改动 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 失败，基线既有 3 份 Issue 267 文档缺少 frontmatter；本次新增文件未报错 |

首次专项为 56 通过、4 失败：3 个成功路径子测试及其父测试受 macOS `/var` 与 `/private/var` 别名影响。fixture 临时根改为 realpath 后，专项与既有测试合计 63 项全通过；未为该断言修改生产路径行为。

构建有现有 WebUI `use client` 与 chunk 大小提示，命令退出 0。未扩大本任务修复范围。

## 验收映射

- A1-A7/A10：解析测试覆盖数组多包非首项、对象多包、可省略 name、自有键、空白和额外字段、缺失/重复/身份冲突、非法 JSON、字段边界。数组合同由 fixture 验证，未安装旧 npm 或宣称旧 npm 端到端通过。
- A8：完整脚本 fixture 覆盖 bundled 数量不足，断言失败无成功 stdout；还覆盖错误元数据与 npm 非零退出，且每次核对物料临时目录已经删除。
- A9：真实 npm 12.2.1 归档成功，大小 `1628599` 字节，包含全部 68 个声明包。
- A11：发行脚本结果包含 offlineInstall、publicTypes、builtinExtras、webuiAssets、nativeKernel、independentExtra、gatewayHostStore、extraStatusSink、sdkRecoveryProbe、cliKernel、uninstallPreservedHome，全部为 true；CLI 版本与帮助入口检查通过。所有安装和组件实例由现有验收脚本在隔离目录中创建及回收，未替换用户全局 Runtime。
- A12：CI 范围、lint、typecheck、格式检查通过；全仓知识格式检查保留基线失败。用户已认可该已知问题，功能与发行验收按成功处理。

## 归档来源与内容指纹

- 归档：`dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`。
- 内嵌 commit：`a5a32835882deab5e2364b559dd06bf1675c1335`；dirty：`true`；buildTime：`2026-10-31T18:11:15.826Z`。
- 未提交构建不传 `--require-clean`，构建 SHA 不代表已提交本次修复。

SHA-256：

```text
c46f1fa51ba2634d72eb0f3ac3dc1a49058060ebbb57356cbb264f968474a807  scripts/pack-release.mjs
476608c8a2d77b0d1f12b2938540ee66004909dfc7f58dbfc0a23e62e2cb62e5  scripts/parse-npm-pack-result.mjs
201edcbf9d42ee305d8f4df9a0d0839de35a132bbb73d94e9e4945b15dcaa9f5  test/manual/npm-pack-json.test.mjs
b200d0c2c2dc124233a66c49363f2c8a47bd2bcc5d9534f30e70c62792c1b3dc  dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
```

## 基线失败与恢复

全仓知识检查的唯一 3 项错误为：

- `.octospec/tasks/267-cli-help-attribution/brief.md` 缺少完整 YAML frontmatter。
- `.octospec/tasks/267-cli-help-attribution/validation.md` 缺少完整 YAML frontmatter。
- `.octospec/journal/shared/2026-11-01-267-cli-help-attribution.md` 缺少完整 YAML frontmatter。

规格阶段已用 `git show HEAD:<path>` 核实这些错误存在于 `0c67c256` 基线，实现前更新至 `a5a32835` 后上述文件无变化，本次不改无关文档。文档检查失败没有影响已完成的解析与发行验证。用户随后明确认可验证结果，并要求将实施结果按成功转为验证审查、继续 create-pr；因此不再要求实现重试，保持原始检查结果与本次接受决定可追溯。

## 限制与审查

[双轴审查](review.md)各 0 发现。未运行全量测试套件、Linux、Windows、Node 26、旧 npm 端到端或托管 CI；本次不改变跨包运行合同。未调用真实 Provider、模型或 IM。
本轮仅修正状态与记录，生产代码和测试内容未变。提交前及提交后核对上述源码 SHA-256，确认交付代码与已验证内容一致，不将提交前 dirty 归档伪称为新提交的 clean 构建。后续提交、推送、PR 链接由 Loop 记录；没有合并或发布授权。
