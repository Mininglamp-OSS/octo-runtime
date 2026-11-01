---
type: Validation
title: ORT-5 文档实施与验证
description: 记录双语上手路径的实际修改、独立消费验证和未执行范围。
tags: [documentation, testing, runtime]
---

# 结果

完成本次限定的 docs 增量整改，等待验证审查；不代表原 Issue 全部治理要求完成。产品变更仅 `docs/`，无提交、推送或 PR。

## 版本与范围

- 2026-11-01，原 worktree/分支 rebase 到最新 `origin/main@49f9b11f58c13a65cc62e74d2c4751cac99a3707`；记录对应此基线加未提交文档/示例变更。
- 环境：macOS arm64，Node.js 24.22.2。
- 双语入口、CLI、SDK、Extras、Harness、排障、maintenance，共 14 个已有页面；新增共享 `dsh-invoke.mts`、`gateway.mts`。
- 保留原目录、标题和语气；未改 Runtime、依赖、测试入口、workflow 或根文档。本目录仅为流程产物。

## 验收对应

| 项目 | 实现与证据 |
| --- | --- |
| A1 | 中英入口先选 CLI/SDK；playboard 位于持久服务前，octo-cli 后移为可选工具 |
| A2 | 原 CLI JSON 经当前 Protocol 校验；打包版 playboard 使用实际 Codex Adapter 加现有 fake-native-codex，唯一 run.completed，无失败/取消，临时目录为空 |
| A3 | 包外临时 npm 工程安装本次 tgz；实际 attach.mts 输出 answer；关闭 attached client 后另一个 client 仍完成调用，最后 close.complete=true |
| A4 | 完整 DSH 公开 worker/service/入口严格编译；编译 worker 在关闭 stdin 时成功退出，未探测 Provider；入口使用替代测试 Adapter 完成本地 Kernel 调用、终态与清理 |
| A5 | 实际两种 loader 返回数组/Promise，通过 Context 校验，读取更新数据且支持取消；完整 Gateway 示例无联网构造并关闭；既有发行验证覆盖 Extra 初始化/独立关闭和 Gateway 宿主存储 |
| A6 | 核对 supervisor 的清理/manifest 1/2/5 秒与启动 250ms/1s/4s、后续15秒；区分 DSH SDK rc.3 与 Provider 最低 rc.4 |
| A7 | docs:check 及 current 链接审计通过，人工复核配对页面前置条件、终态、取消和清理含义 |
| A8 | maintenance 保留旧证据并追加本版本、dirty、平台、命令及未执行项 |
| A9 | diff 仅 docs 和本任务产物；未改 CI、默认测试或用户 Home，未提交/推送 |

## 命令与结果

- `pnpm install --frozen-lockfile`：通过，其 prepare 包含完整构建。
- `pnpm docs:check`：通过；18 组双语页面、37 个 Markdown、22 个 JSON、16 个 Mermaid 块、12 类 Context、4 项测试。
- `node scripts/check-developer-docs.mjs --scope current`：最终通过，131 文档、1815 链接、87 fragment、0 错误；85 外部链接按现有脚本跳过。
- `node scripts/pack-release.mjs`：生成 `dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`，未发布。
- `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`：通过；offlineInstall/publicTypes/builtinExtras/webuiAssets/nativeKernel/independentExtra/gatewayHostStore/extraStatusSink/sdkRecoveryProbe/cliKernel/uninstallPreservedHome 全部 true。
- `node /tmp/ort5-docs-validation.mjs`：显式临时 harness，通过 standaloneTypes/compiledDshWorkerExecuted/attachAndKernelSurvival/dshEntryWithFixture/syncAsyncContextsAndCancellation/gatewayConstruction/cliActualRequestFakeCodex/temporaryKernelCleaned；独立消费目录 `/tmp/ort5-tbW1Ca` 已回收。harness 不加入默认测试。
- `git diff --check`：通过；产品 diff 无 `.github`、package.json、检查脚本或 Runtime 变更。
- `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`：通过，560 个 OKF 单元、20 条规则、3519 个本地文件链接；本任务 Markdown 元数据有效。

## 实施中发现与处理

- 当前 CLI status JSON 不提供 Kernel endpoint，规格中“取实际字段”的假设不成立。改为公开 `componentEndpoint(exactHome)`，SDK 宿主使用自身配置的 endpoint；没有猜测平台路径或增加 API。
- Gateway 模块使用 namespace import，满足公开 `ExtraPluginModule` 合同。
- 包外安装当前 TypeScript 后，仅安装 @types/node 不足以自动启用 Node 类型；实际命令增加 `--types node` 后严格编译及执行通过。双语同步修正。
- Standards 审查无问题；Spec 审查发现空动态列表和 loader 失败边界说明遗漏，已补齐两种语言。详见同目录 review.md。

## 限制

真实 Codex/DSH 初始化与模型调用、线上 IM、外部 MCP、Electron 和原生 Windows 未执行。fixture 仅验证本地合同，不能当作真实 Provider/IM 通过。未修改图，无需沿用旧图渲染作为新证据。原 Issue 的根文档/贡献治理及 Octospec 整理不属于用户批准范围。

## PR 前同步与复验

用户“更新最新代码 然后 提交PR”授权提交、推送和创建 PR。2026-11-01 fetch 后，原分支已无冲突 rebase 至 `origin/main@4a0f53b50723422d90f051944ae19eb28f60712a`。新增上游 #278 仅修改验证脚本及其工程记录，不影响本次文档/API；原文档和示例完整保留。

- 新基线加准备提交的文档变更，在同一 macOS arm64 / Node.js 24.22.2 环境重新通过 `pnpm build`、`pnpm format:check`、两份新示例的显式 Prettier 检查和 `pnpm docs:check`（4项测试）。
- current 审计通过：131文档、1817链接、87 fragment、0错误，85外部链接跳过。
- 重新 pack 后，`node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 4a0f53b50723422d90f051944ae19eb28f60712a` 通过，校验打包源码版本及全部现有发行场景。
- `node /tmp/ort5-docs-validation.mjs` 在新包上重新通过全部前述独立消费场景；临时目录 `/tmp/ort5-yoU2bE` 已回收。
- 相对 main 无 workflow、依赖、默认测试或运行时 diff；GitHub 当前必需检查仍为 `CI Gate`。远端 CI 结果与这些本地验证分开报告。
- 双语 maintenance 追加本次复验，保留此前证据。真实 Provider/IM/Windows 等未执行范围不变。不执行合并。
