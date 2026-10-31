---
type: Validation
title: Issue 145 本地验证与边界
description: 记录公共示例合同验证、相关回归、双轴审查修复及既有知识格式失败。
tags: [documentation, protocol, testing]
timestamp: 2026-11-01T02:30:00+08:00
---

# 验证结论

文档及接口注释修复已完成，A1–A7 本地验收通过。首次实现阶段因全库 OKF lint 有 7 处基线已有文件缺 frontmatter，按 devflow 的实现失败分支回到待规格审查；该阶段的原始命令及结果保留如下。

用户随后明确要求补强 workflow 的 YAML 元数据约束，并补齐这 7 份历史文档。补齐后全库 OKF lint 已通过，详见下方复验记录。此次补齐不自动迁移 Loop 阶段，也不表示已获提交、推送或创建 PR 授权。

首次实现阶段未提交或推送；用户随后已授权交付，合并主线后的当前验证与提交状态见下节。

## 主线同步后的交付复验

- 用户授权：任务分支提交、同步最新 main、推送并创建 PR；不包含合并 PR 或发布。
- 任务提交 `1c1909d1`；合入 `origin/main@db427e85dbaf1c19e79452ed4a45f6080c440a0f` 后代码版本 `8c95ea7065c713b52396794f0df09269a6fef6cd`，验证前工作区干净。
- 合并冲突仅涉及知识索引、日志及同一批元数据；保留双方任务入口与主线已有标题、描述、标签和时间戳，审查/验证文档分别使用 Review/Validation。历史正文未改写。
- 合并后重新执行 `pnpm typecheck`、`pnpm docs:check`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`，均退出 0；文档运行示例 4/4 通过。
- `node scripts/manual/145-sdk-protocol-contracts.mjs`：8/8 通过；同上所列五个文件的相关回归共 71 项，70 通过、1 Windows 平台条件跳过、0 失败。
- `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`：退出 0，541 个知识单元、20 条规则、3428 个本地链接通过。此前 7 处失败已消除。
- Standards / Spec 对 `origin/main...8c95ea70` 分别独立复核，无剩余问题；要求补齐的当前交付记录已更新。之后仅修改本任务的知识记录，未改变已验证代码和专项。
- 相对目标分支 `.github/workflows`、`package.json`、`pnpm-lock.yaml`、`docs/checks` 和 `scripts/check-developer-docs.mjs` 的 diff 为空；没有增加 CI 或默认检查范围。
- 本轮日志位于 `/tmp/ort47-delivery-{typecheck,docs,manual,regression,lint,names,format}.log`。当前交付记录随单独文档提交归档；最终提交和 PR 引用记录在 Loop 任务交付评论中。
- 未执行真实 Provider、远端模型、IM、Electron、原生 Windows/Linux 或全量 `pnpm test`，原验收边界不变。不将本地通过写成 GitHub 托管检查通过。

## 版本与环境

- HEAD：`f7384fcbc63b3392af6972c0da6e756bee80ac60`，dirty；原规格与当前改动均未提交。
- 实现开始时 fetch 的目标：`origin/main@a5a32835882deab5e2364b559dd06bf1675c1335`。新增 #269 为长任务预算、#270 为文档链接治理；未同步，结果仅对应当前 HEAD 与工作区，不能视为合并最新主线后的验证。
- 主机：`lvsijiaMacBook-Pro.local`，macOS；Node `v24.22.2`，pnpm `11.19.0`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-145`；分支 `fix/145-sdk-protocol-docs`。
- 最终手动脚本 SHA-256：`123529d53e88e77d4dcb69ba7d7406b4b61f0936de14041d2a0e842a028a0223`。
- fake worker SHA-256：`5d4843a229f8fcd671a0f2286505f4dca25d3c752e860d11a64e6472e41f0e92`。

## 命令与结果

| 命令 | 退出码及结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0；锁定依赖安装及 prepare 构建完成，无 lockfile 改动。 |
| `pnpm typecheck` | 0；workspace 类型检查与构建完成。日志 `/tmp/ort47-typecheck.log`。 |
| `pnpm docs:check` | 0；18 对双语页面、37 个 Markdown 文件、22 个 JSON 示例、16 个 Mermaid 图和 12 个内置 Context 示例；4 个现有运行示例通过。日志 `/tmp/ort47-docs.log`。 |
| `node scripts/manual/145-sdk-protocol-contracts.mjs` | 最终 0；8 项通过，0 失败/跳过，含 A1–A7 与清理故障注入。日志 `/tmp/ort47-manual.log`。 |
| `node --test test/native-host.test.js test/context-configuration-protocol.test.js test/context-envs.test.js test/kernel-ipc-contract.test.js packages/octo-runtime-protocol/test/run-protocol.test.js` | 0；共 71 项，70 通过、1 跳过、0 失败。跳过的是 Windows 子进程大小写环境覆盖项，当前主机不适用。日志 `/tmp/ort47-regression.log`。 |
| `pnpm lint` | 0；日志 `/tmp/ort47-lint.log`。 |
| `pnpm lint:names` | 0；无 findings，保留原有历史例外。日志 `/tmp/ort47-names.log`。 |
| `pnpm format:check` | 0；审查修复后再单独对两个最终手动脚本执行 Prettier 检查并通过。日志 `/tmp/ort47-format.log`。 |
| `python3 .octospec/scripts/lint.py` | 1；系统 Python 缺 `yaml`，检查未启动。使用下行独立环境实际运行。 |
| `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` | 1；7 处已有文件缺 frontmatter，见下文。日志 `/tmp/ort47-okf.log`。 |
| `git diff --check` | 0。新知识文件另做 frontmatter、YAML、路径和链接核对。 |

## 验收对应证据

- A1：从 Protocol/Adapter SDK 两套中英 README 各提取一个完整 TypeScript 代码块，共 4 个；与现有 `docs/examples/*.mts` 一起 strict 编译。Protocol 仅补 `export { input }` 便于执行校验，未修改示例字段。根发行包不依赖私有 Adapter SDK，临时目录显式链接本次工作区包，执行后删除。
- A2：实际执行两语言的 echo Adapter，final 文本为 `example` 且仅一个成功终态；每条事件经 `assertCanonicalEvent` 和 `CanonicalEventWire` Schema 校验。调用现行 `envelope`，核对身份、连续序号、UUID、时间戳、版本及冻结状态。Schema 没有独立 `EventEnvelope` 定义，因此复用事件和 RunIdentity Schema 并单独断言元数据，未新增协议定义。Ajv 对现有 Schema 的 `date-time` 格式有两个未注册警告；本组 echo 事件不含日期字符串，不据此声称验证了全部日期格式。
- A3：直接 Core 默认及显式 native 运行 native-only Adapter，均得到 native 输出与 completed 控制帧，canonical 帧和转换报告为零；canonical-only 默认 native 在调用前拒绝，显式 canonical 完成。对象签名通过真实本地 Kernel；关闭 attached client 后仍能从服务自有 client 查询原 Kernel PID。
- A4：defaults `A=base,B=default`、request `A=request,C=request`、mandatory `A=locked` 得到 `A=locked,B=default,C=request`；请求无 A 时同样补 locked；空 mandatory 不删除；输入快照未修改。
- A5：旧公共包装字段 `protocolMode/adapterType/request/options`、无版本事件和 `run.finished` 分别被当前校验器拒绝，与正向示例分开断言。
- A6：一个真实本地 Kernel、独立 fake worker、两个活动 Run，各建立 8 个订阅并等 ACK；第 17 个直接得到 `STREAM_SUBSCRIBER_LIMIT`。结束首个 Run 的一个订阅后，第二个 Run 可以补占该共享额度；只对服务器尚未归还额度的容量拒绝做 5 秒内重试。两个 Run 显式取消并查询确认 cancelled，最后所有 socket/client/service 均关闭，服务返回 `complete=true`，删除所属临时目录。
- A7：双语对象签名和共享容量表述一致；两个生产 TS 文件经 TypeScript scanner 去掉 trivia 后 token 与 HEAD 完全一致，证明只改注释。CI、默认脚本、依赖、Schema 和生成类型未改。
- 审查补强：注入原业务断言和 socket 清理错误，仍执行后续 owner 关闭，AggregateError 保留两原错误；对真实已 ACK 的订阅 socket 注入错误事件，socket/readline 两层记录同一个错误而不吞掉或重复计数。

## 首次实现阶段的全库知识格式失败

下列 7 个文件在规格阶段已逐一用 `git show HEAD:<path>` 核对，内容与当前工作区字节一致，且在 HEAD 已缺 frontmatter。本轮未修改这些文件：

- `.octospec/tasks/137-adapter-protocol-support/brief.md`
- `.octospec/tasks/137-adapter-protocol-support/review.md`
- `.octospec/tasks/246-gateway-projection-window/validation.md`
- `.octospec/tasks/267-cli-help-attribution/brief.md`
- `.octospec/tasks/267-cli-help-attribution/validation.md`
- `.octospec/journal/shared/2026-10-29-137-adapter-protocol-support.md`
- `.octospec/journal/shared/2026-11-01-267-cli-help-attribution.md`

首次实现阶段未修改上述文件，也未将原始失败写成通过。后续用户授权的修复与复验见下节；若同步主线，仍必须针对新版本复验，不能复用当前通过结论。

## 用户授权补齐后的知识格式复验

- 授权来源：用户要求“skills修复了吗？然后这7个也都补上yaml元数据”。
- 已在仓库 workflow skill 的源文件与使用副本、共享入口源文件及 AGENTS.md / CLAUDE.md 中明确 YAML 元数据强制要求。
- 上述 7 份文档均补齐 `type`、`title`、`description`、`tags`；已逐一与 HEAD 对比，去掉新增元数据后，历史正文完全一致。
- `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`：退出 0，526 个 OKF 单元、20 条规则、3383 个本地文件链接通过。
- `git diff --check`：退出 0；workflow skill 源文件与使用副本一致。
- 本次只补充文档约束及元数据，未修改生产代码、测试、CI 或默认脚本；未重跑已通过且未受影响的功能专项与回归。当前修改仍未提交、未推送。

## 审查与范围

采用 `code-review` 技能执行 Standards/Spec 独立并行审查。初轮分别 2 项/1 项，均为手动 harness 的失败清理及错误传播，已修复；复查剩余均 0，见 [review.md](review.md)。

固定基线至工作区：`.github/workflows`、`package.json`、`pnpm-lock.yaml`、`docs/checks`、`scripts/check-developer-docs.mjs` 无 diff。新增入口位于 `scripts/manual/`，不匹配既有测试 glob，不修改默认脚本，不增加 job、矩阵、触发器、必需状态或 Gate 依赖。已核对相对本地目标分支的 workflow diff 为空；本分支没有提交和托管检查，不能将主线已有检查当作本次 CI 通过。

未执行真实 Provider、远端模型、IM、外部 Electron、原生 Windows/Linux 验收或全量 `pnpm test`。本次只有文档/注释和手动 harness，执行的是明确的本地合同与相关回归，不宣称真实 Provider 或其他平台已通过。
