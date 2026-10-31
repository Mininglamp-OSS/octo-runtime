---
type: Task
title: Issue 145 公共 SDK 示例与协议说明对齐
description: 修正过期接入说明，验证可复制示例及模式、配置覆盖和共享订阅预算合同。
tags: [documentation, protocol, adapter, invoke, ipc, testing]
timestamp: 2026-11-01T02:07:48+08:00
---

# 目标

让 SDK 使用方可以复制当前示例并通过类型与运行时校验，按真实接口连接 Kernel，正确理解 Adapter 输出模式、mandatory 配置覆盖及订阅容量。修复文档与接口注释，不通过恢复旧兼容行为改变运行时。

来源：[GitHub Issue 145](https://github.com/Mininglamp-OSS/octo-runtime/issues/145)、Loop ORT-47 的分诊评论 `5a7069de-8c65-44aa-a134-33d432c33307`，以及用户“开始写spec”请求。Issue 的旧基线复现是问题背景，不作为本次版本已通过的证据。

## 基线与阶段

- 仓库基线：`f7384fcbc63b3392af6972c0da6e756bee80ac60`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-145`；分支 `fix/145-sdk-protocol-docs`。
- 规格核对时本地 `origin/main` 已到 `0c67c256`（PR #270）。该提交调整文档链接检查等内容，未改动本任务列出的 SDK/架构段落；当前分支未同步该提交。实现开始时重新检查目标分支差异，再决定是否需要同步，不能沿用旧验证结果。
- 本阶段只产出规格、上下文记录和目录入口；产品修复及下文验证尚未执行。未获得提交、推送、创建 PR 或合并授权。

## 目标与决定权归属

1. 真实需求是可复制的集成路径；当前错误由本仓维护的说明产生，应在文档及就近注释修复。
2. Runtime 维护通用输入、校验、传输和资源预算合同；宿主选择 Adapter、输出模式、业务 Context 及生命周期策略，Adapter 只执行声明的模式和原生映射。
3. 调用方显式提供 `InvokeInput` 和连接 endpoint；本次不补造模式选择、会话历史、Provider 参数或业务默认值。
4. SDK、CLI、Extra 共用的运行时默认行为、权限和配置保持现行合同；canonical-only 示例须明确选择 canonical，不能将其推广为全局默认。
5. 所有权按原接口保留：attach 客户端仅拥有自己的连接；创建服务的宿主负责关闭服务，停止观察不表示取消 Run。
6. 本次不新增默认、降级、重试、自动安装或持久化机制。

## 关键合同与修改范围

| 编号 | 内容与目标行为 | 修改或复核位置 |
| --- | --- | --- |
| R1 | 公共输入使用 `inputs`、Context v3 `contexts` 和 `protocol_mode`；canonical event 带 `protocolVersion: 2`，终态使用 `run.completed/failed/cancelled`。封套使用 `agentSessionId` 与 `runId`，不能混为 Provider session。Run=7、Context=v3、Adapter transport=2 分别版本化。 | Protocol 中英 README、Adapter SDK 中英 README；Protocol 主要示例已在基线修复，保留有效内容并核验。 |
| R2 | 已有服务连接签名为 `attachKernel({ endpoint })`；连接按调用需要建立，服务须已就绪，关闭 attached client 不关闭 Kernel 或取消 Run。 | 双语 `getting-started/sdk.md`、`concepts/architecture.md`；复核正确的 `docs/examples/attach.mts`。 |
| R3 | 公共 `InvokeInput.protocol_mode` 与内部 `context.protocolMode`、`HostInvokeOptions.protocolMode` 必须区分。默认 native，canonical 显式选择；Adapter 按声明及本轮模式输出。native-only 不要求产生 canonical 事件或调用 canonical converter。canonical 模式才要求统一 canonical 类型。 | `.octospec/guides/providers.md`、`adapter-authoring.md`，Core/Protocol `src/index.ts` 就近注释，以及两个包的中英 README。 |
| R4 | env 列表按 key 依次合并 defaults、request、mandatory；同名 mandatory 最后覆盖，不因请求值不同抛 `CONTEXT_MANDATORY_CONFLICT`。未覆盖的默认和请求 key 保留，空列表不删除低层项。描述仅针对当前 env 合并，不泛化为取消所有 mandatory 冲突或权限校验。 | `.octospec/rules/environment.md` 的合并与冻结段；以 `resolveContextConfiguration` 和 `mergeContextEnvs` 为依据。 |
| R5 | 单 Kernel 同时最多 16 个输出订阅，由全部 Run/客户端共享；与 Kernel 64 个并发连接和单客户端 32 个在途连接分别解释。订阅结束后释放额度，不新增订阅参数或改预算。 | 双语 `reference/kernel-ipc.md`；以 `server.ts`、`HostRunService.acquireSubscription`、客户端连接计数为依据。 |
| R6 | 将示例正确性与模式/覆盖/预算控制写成可重复执行的正向验收；旧格式的预期拒绝单独表达。新专项只显式本地运行，不进入默认 glob、脚本或 CI。 | 独立入口 `scripts/manual/145-sdk-protocol-contracts.mjs`，如需隔离 worker 则使用同目录的明确 fixture；验证记录写入本任务 `validation.md`。 |

对上述位置只修改错误合同及直接关联文字；有正确内容的示例不为追求 diff 重写。核心接口注释使用简短中文 JSDoc；双语公开文档保持语义一致。实现中若发现邻近同主题矛盾，可在同一文件内同步修正并记录；其他主题另行列出。

## 验收设计

新增专项入口使用仓库已有 Markdown AST 解析器提取指定文件的完整代码块，使用 TypeScript 编译器和当前 Protocol 校验器验证；不靠字符串拼接伪造已修正的替代示例。对于说明性片段，harness 可补必要 import、合法固定身份或外层调用，但须记录补充内容，不改示例中的合同字段和参数。提取不到目标代码块或未实际执行案例须失败。

| 验收项 | 执行与可观察的通过条件 |
| --- | --- |
| A1 示例类型与输入 | 严格 TypeScript 编译 README 的可复制输入/Adapter 示例及现有 SDK `.mts` 示例，无类型强转或禁用诊断绕过；对实际输入执行 `InvokeInput.check`。包内示例使用工作区入口，发布 SDK 示例使用现有公开 subpath，不新增导出。 |
| A2 事件与身份 | 执行实际提取的 echo Adapter，断言 final 文本等于输入且只有一个成功终态；每条 canonical event 通过 `assertCanonicalEvent`。使用当前 `envelope(run, seq, event)`，核对 `agentSessionId`、`runId`、序号、版本，并对封套执行当前 JSON Schema 校验。当前 Protocol README 若只有说明、没有封套代码块，用当前 API 单独构造正向控制，不声称提取了不存在的示例。 |
| A3 连接与模式 | 对象签名在真实本地 Kernel/fake worker 上连接并完成一次调用；中英四处签名一致。注册显式 native-only 测试 Adapter，以公共 `invoke` 默认/native 调用，观察 native 帧及 `completed` control，canonical 帧和 canonical converter 调用均为零；canonical-only Adapter 使用 `protocol_mode: "canonical"` 正常完成，默认 native 被明确拒绝。 |
| A4 mandatory 覆盖 | defaults `A=base,B=default`、request `A=request,C=request`、mandatory `A=locked` 得到 `A=locked,B=default,C=request`，不抛冲突；缺 request A 时同样补入 locked；空 mandatory 列表不删除原值；原输入不被修改。全部值为非凭据普通文本。 |
| A5 旧格式拒绝 | 当前公共校验拒绝 `protocolMode` 等已删除包装字段、缺失版本的 canonical event 和 `run.finished`；这些负向断言独立命名，不能用“错误示例仍失败”代替正向示例通过。内部 `protocolMode` 仍按其现有类型和合同使用。 |
| A6 共享容量 | 启动一个真实 Kernel 和可控 fake worker，提交两个保持活动的 Run；等 ACK 确认两 Run 各 8 个订阅占用，共 16 个，第 17 个因 `STREAM_SUBSCRIBER_LIMIT` 被拒绝。关闭其中一个订阅并在有界期限内确认释放，另一个 Run 能申请替代订阅；清理全部订阅、Run、客户端和本次服务。不得只在同一个 Run 或 mock 计数器上证明共享作用域。 |
| A7 范围与证据 | 文档中英表述一致；工作区 diff 只有本规格允许的文档/注释及手动验证产物。相对目标分支的 workflow diff 为空；默认脚本、自动 glob、检查列表和依赖关系无专项增量。记录 HEAD、dirty、Node/pnpm、命令及退出码、通过/失败/未执行和原因，不把旧证据或已知缺陷断言写成本版通过。 |

手动 harness 使用受控临时目录和当前工作区构建产物，不调用真实 Provider、账号、IM 或远端模型。IPC/文件只属于本次测试；等待订阅建立、额度释放及关闭均有期限。使用控制信号/ACK 确认阶段，不依赖固定 sleep 推定已就绪；失败保留原诊断并回收所属资源，清理失败不能记为通过。

## 实现阶段验证命令与交付顺序

1. 复核本规格、当前源合同与目标分支；按仓库方式安装锁定依赖，修改文档及就近注释。
2. `pnpm typecheck`：构建与严格类型检查，生成文件不得出现无关漂移。
3. `pnpm docs:check`：原有双语文档、现有示例编译及运行检查；不为本任务扩展该入口或其自动测试目录。
4. `node scripts/manual/145-sdk-protocol-contracts.mjs`：显式运行 A1–A6 专项；有子进程时检查其退出码，任一正向、负向或清理断言失败则总命令非零。
5. `node --test test/native-host.test.js test/context-configuration-protocol.test.js test/context-envs.test.js test/kernel-ipc-contract.test.js packages/octo-runtime-protocol/test/run-protocol.test.js`：现有相关回归，记录实际用例数与结果。复用已构建产物，不扩大 CI。
6. `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`python3 .octospec/scripts/lint.py`、`git diff --check`；检查新 Markdown frontmatter、链接和规格目录入口。
7. 采用 `code-review` 对固定基线至工作区改动执行 Standards/Spec 双轴审查，处理问题并只重跑受影响验证。审查流程按该技能执行，尚未在规格阶段启动。
8. 将 A1–A7 与命令的实际证据写入 `validation.md`，进入验证审查。没有跨包行为修改时不额外运行真实 Provider 或全量模型测试；出现运行时行为缺陷时记录并返回规格审查，不在文档任务内顺便修复。

本任务的自动化含义是本地脚本可重复执行，既有 `docs:check` 保留原覆盖。原 Issue 中“新增 CI 检查”的建议不能覆盖用户禁止扩大 GitHub CI 的约束；新增专项不进入 workflow、job 步骤、矩阵、默认测试开关或 CI Gate。

## 范围外

- 不修改可执行运行时逻辑、公开类型结构、Schema、生成协议、字段兼容、模式默认值或资源预算。
- 不发布私有 Adapter SDK，不增加公共 subpath 或插件装配接口。
- 不做真实 Provider、IM、远端服务或外部 Electron 验收，不修改用户 Home、身份、凭据和现有运行实例。
- 不新增 GitHub CI 验证范围，不提交、推送、创建 PR、合并或部署。未来获得提交/PR 授权时，OSS commit 与 GitHub issue/PR 使用英文，保留配置的作者身份；Codex 实施的提交按用户要求带唯一 attribution trailer。

## 已确认决策与待审查项

已确认：接受分诊范围；以当前运行时合同修正文档；保持 public snake_case/internal camelCase 区分；保留主线已修正示例；专项验证显式手动运行，CI 不扩围；仅进入规格阶段。

本次无阻塞实现的技术待决策点。供本次规格审查确认的选择如下，尚未代表实现授权：

- 是否接受 `scripts/manual/` 独立专项入口和 A1–A7 验收粒度；默认方案如上，不要求真实 Provider 或新增 CI。
- 是否认可文档范围、上述基线处理和运行时缺陷返回规格审查的边界。

实现开始时发现的新需求或与本规格冲突的源合同，须列出差异再处理，不能静默修改已确认决策。下一阶段命令为“开始实现”；需改规格时提供反馈并使用“优化 spec”。

## 可执行性自评

| 维度 | 得分 | 依据 |
| --- | --- | --- |
| 目标与范围 | 20/20 | R1–R6 对应具体文件，已修复内容与剩余问题分开。 |
| 合同与责任 | 20/20 | 模式、身份、覆盖、预算与服务所有权均有源码依据。 |
| 验收可观察性 | 24/25 | A1–A7 有输入和通过条件；实际编译/IPC harness 尚待实现。 |
| 执行与证据 | 19/20 | 命令、输出与清理要求明确；依赖和平台结果待实际验证。 |
| 风险与授权 | 14/15 | CI、旧基线、类型边界及授权明确；实现开始时仍需核对新主线。 |
| 合计 | 97/100 | 是规格准备度自评，不是实现质量、测试通过率或验收完成度。 |

## 本次规格检查记录

- 通过：新 brief 的 Task frontmatter、context YAML、规则路径、本地链接和三个变更文件的尾部空白检查；`git diff --check` 通过。相对本地 `origin/main` 无 workflow diff。
- 全库检查未通过：系统 `python3 .octospec/scripts/lint.py` 因缺少 PyYAML 未启动；改用 `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` 后实际报告 7 处既有 Markdown 缺 frontmatter。
- 既有问题位置：`137-adapter-protocol-support/{brief,review}.md`、`246-gateway-projection-window/validation.md`、`267-cli-help-attribution/{brief,validation}.md`，以及 journal 的 `2026-10-29-137-adapter-protocol-support.md`、`2026-11-01-267-cli-help-attribution.md`。已逐一通过 `git show HEAD:<path>` 比较，确认与基线字节一致且原本缺 frontmatter；不纳入本次修复范围。
- 未执行：A1–A7 功能验收、构建、类型检查、真实 Kernel 专项及代码审查，均属于实现阶段。独立 harness 和 `validation.md` 尚未创建。

## 实现阶段记录

用户随后已明确“开始实现”，接受本规格范围和手动验证方案；原规格阶段记录保留其当时含义。文档与接口注释已修正，独立 harness 及 fake worker 已创建，双轴审查问题已修复。A1–A7 的最终证据和全库检查失败边界见 [validation.md](validation.md)，审查见 [review.md](review.md)。本轮整体验证未全部通过，按工作流退回待规格审查，不自动提交或推送。
