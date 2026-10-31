---
type: Task
title: Issue 149 Provider 接入文档与所有权说明对齐
description: 仅修正文档与注释，按当前实现说明配置、显式会话续接、图片输入和进程清理边界。
tags: [documentation, adapter, protocol, session]
timestamp: 2026-11-01T00:00:00Z
---

# 目标与确认依据

对应 [GitHub #149](https://github.com/Mininglamp-OSS/octo-runtime/issues/149) 与 Loop ORT-50。用户已确认仅文档及注释修正，并通过“开始实现”授权实施；随后明确授权顺便修复 OKF 格式问题、commit 和创建 PR，包含推送所需分支。不自动合并。

基线 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，分支 `docs/149-provider-onboarding`，worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-149`。规格期间已知 `origin/main` 领先两项提交，包含 #270 文档校验更新；本规格保持原基线，实现前核对上游差异和检查命令，不覆盖其链接校验成果。

原 issue 依据 `8214292132d260c04cf72218580bef741788dd4a`。PR #191 已重写 Provider 双语 README，移除了多数旧字段示例，并说明 Codex 图片输入。当前双语 `context-and-sessions` 已要求保存和显式回传完整 `providerSession`。本任务补齐剩余错误和缺失说明，不能将旧 issue 的每一项都当作当前缺陷。

## 产品意图与责任归属

接入者应能运行当前示例，并准确理解谁决定权限、谁保存会话、谁清理进程。

- 业务方决定本轮权限策略、推理强度、会话继续或新建，提供本轮 `inputs`、`contexts` 和可选完整 `providerSession`；业务 binding、历史及持久保存由业务方管理。
- Core 按现有输入合同准备本轮请求；Adapter 翻译 Provider 参数、返回真实会话及执行结果，清理其拥有的资源。
- 本任务的合同内动作是更正文档、链接和解释所有权的源码注释。对 SDK、CLI 和 Extra 的运行行为、默认值及接口均无改变。
- 不让接入方重复实现 Adapter 已拥有的正常 POSIX 清理，也不将 Provider 会话存在描述成恢复保证。

# 修改范围

| 范围 | 处理要求 |
| --- | --- |
| Codex `src/app-server.ts` 的 session update 注释 | 必改：删除 Core 持久保存 Provider session 的说法；解释 turn/start 成功后才发布供调用方保存的权威会话更新。仅改注释。 |
| `.octospec/guides/adapter-authoring.md` | 必改：替换 SDK 只终止直接子进程的笼统说法，明确实际 helper 参数与调用路径决定清理范围。 |
| Codex、Claude Code 的 `README.md` 与 `README.zh.md` | 必改：补齐实际进程所有权、平台限制，并链接公共会话与协议说明；英文与中文合同一致。 |
| 其余 Provider 双语 README、公共输入/会话/输出指南 | 复核权限与推理示例、会话保存、图片说明、旧 daemon 命令和终态图。仅在仍有错误或必需链接缺失时增量修改，已正确内容保留。 |
| `.octospec/tasks/149-provider-onboarding/` 与本轮 journal | 保存规格、规则来源、逐项验收证据与未验边界；必要时补知识目录入口。 |

不改可执行语句、类型、Schema、默认值、依赖、包导出或测试实现，不增加兼容旧字段、会话存储或清理机制。不改 CI、必需检查、测试脚本或默认开关；专项只本地显式运行。历史 journal、旧任务和固定版本证据不批量替换字段；若作为当前入口会误导，则增加版本说明或指向现行指南。

# 必须表达的合同

## 配置与默认值

1. 公共接入示例使用 `InvokeInput` 和 Context v3；说明公共 `approvalMode` 可显式设置、必须与已提交 Context 策略一致，不把内部 `InvokeRequest` 当作另一种公共入口。
2. Context 审批使用 `octo.security/approval_policy.payload.mode`；缺省按现有执行准备为 `ask`。推理使用 `octo.execution/model.payload.reasoning.effort`，对应准备后的 `agentConfig.effort`；缺省不传 effort，沿用 Provider 默认，四挡为 `low/medium/high/xhigh`。
3. 当前示例不得推荐 `agentConfig.autoApprove`、`dangerouslyBypassPermissions`、`permissionMode` 或 `thinking`。这类旧字段在内部请求校验中拒绝；不要求改变校验器。
4. 明确 `sandbox`/工作目录是 Provider 配置，不自动构成 OS 隔离。映射及不支持的模式以当前 Adapter 为准，不把某个 Provider 的默认值推广到全部 Provider。
5. OpenCode 原生 `--thinking` 是 CLI 参数，与被拒绝的 Runtime 配置字段不同，不机械删除。Provider 专属参数仅在代码仍支持时保留。

## 会话与图片

1. 业务 `sessionId` 不建立 Core 持久 binding，也不自动恢复 Provider 对话。调用方保存 `session.update.payload.providerSession` 整个对象，包含 opaque 扩展字段，下一轮显式回传；使用代次字段时保留相应业务 fencing。
2. 仅复用业务 ID、未传 Provider binding 时默认 fresh；显式完整 binding 默认 continue。显式 `continuityMode` 必须满足当前 fresh/continue 校验，不能承诺恢复一定成功。
3. Codex 会话更新在 turn/start 成功之后报告。恢复失败后的历史与图片恢复输入由业务方显式提供，不由 Core 或 Adapter 查询、补齐历史。
4. Codex 支持按调用方顺序传入文本与图片，图片编码为原生 image data URL；支持纯图片输入。支持的 PNG/JPEG/WebP、数量/字节/完整性限制链接公共输入参考，避免在每个 README 复制一套数值。所选模型是否接受图片单独判断。

## 清理与终态

| 路径 | 文档必须说明 |
| --- | --- |
| 默认 Codex POSIX spawn | 创建并标记自有独立进程组，清理该组；不是仅终止直接子进程。 |
| Claude Code 经 `spawnJsonLines` 的 POSIX spawn | SDK 创建独立组并 await 有界清理，具有 TERM/KILL 升级和确认；leader 退出不等于全部组成员退出。 |
| 当前 Codex/Claude Windows 路径 | 未启用 helper 的 `processTree` 选项，不能承诺 Adapter 自身回收全部后代。helper 的可选 taskkill 能力不等于所有调用者已使用。Kernel 的其他清理层按自身所有权单独描述。 |
| Codex 注入 `spawnFn` child | 不推定拥有独立组，不向未经登记的组发信号；不得把默认生产 spawn 保证推广到注入 child。 |
| 宿主异常退出或进程脱离受管组/树 | 不保证全部回收；明确正常 await 清理与宿主崩溃限制，不能要求按名称全机扫描清理。 |

取消 ACK、Provider turn/message 完成、Run 终态、资源清理和业务投递是不同事实。现行入口若仍含旧 canonical 终态图，改为当前事实或链接公共协议；不得用文本块、child exit 或停止消费迭代器证明成功。保持实际失败和 incomplete 语义。

# 验收与验证计划

| 编号 | 可观察通过条件 | 验证方式 |
| --- | --- | --- |
| A1 | 所有本轮涉及的现行 Provider 示例使用被接受的字段，默认值与源码一致 | 列出文件/片段清单；对公共片段执行 `InvokeInput.check` 和实际 Core 准备校验，对内部片段执行内部请求校验；不能只依赖会忽略未知扩展的形态检查。 |
| A2 | 完整 binding、显式回传、fresh/continue 及失败恢复责任说明齐全，Core 注释无持久化承诺 | 对照 `invoke-input.ts`、现有会话指南；本地受控 fake Adapter 三轮记录 fresh/fresh/continue，第三轮扩展字段完整保留。使用临时验证脚本，不纳入默认测试。 |
| A3 | Codex 图片说明与混合顺序、纯图片和 fallback fixture 一致 | 构建后运行 `node --test test/adapter-multimodal.test.js`，区分 Codex 与其余 fixture 的证据范围。 |
| A4 | 双语清理说明逐路径区分平台及注入所有权，不误报 Windows 树清理 | 逐项对照 `process-cleanup.ts`、Codex defaultSpawn/cleanup 与 Claude `spawnJsonLines` 调用；本地运行 `node --test test/codex-process-cleanup.test.js test/process-group-cleanup.test.js`。平台条件 skip 如实记录。 |
| A5 | 当前入口无被删除 daemon 命令与旧终态承诺，双语合同一致，历史证据有版本边界 | 对 Provider README 与对应 guides/reference 做定向搜索、阅读和链接检查，保存处理/保留理由。 |
| A6 | 文档可解析、链接可达仓库内目标，未修改产品行为或扩大 CI | 运行 `pnpm docs:check` 与 `git diff --check`；核对 OKF frontmatter、本地链接和双语片段。相对目标分支 `.github/workflows` diff 必须为空，记录实际托管检查列表，不增加检查依赖。 |

实现阶段先完成适用构建，再运行以上既有检查；权限/推理依据补跑 `node --test test/adapter-permission-modes.test.js test/reasoning-levels.test.js test/invoke-input.test.js`。包 README 不在本基线 `docs:check` 遍历范围内，A1 清单必须单独覆盖，不为此修改默认检查脚本。若采用上游 #270 更新后的基线，使用其已有链接检查能力并重新记录版本。

全部结果绑定实际 SHA、dirty 文件、平台和命令；失败/跳过/未执行分别记录。纯文档不要求真实 Provider 调用、安装系统服务或跨平台真机认证。历史 3/3 或其他平台结果只能按原版本引用，不能作为本轮通过。首次验证失败按流程退回规格审查；若发现需要改可执行行为，先报告缺陷与范围影响，再由用户决定。

# 可执行性与待审查事项

可执行性自评 **97/100**，表示规格明确程度，不代表实现或验收已通过。

- 范围与归属 20/20：仅文档/注释，业务与执行责任已确定。
- 合同及源码依据 24/25：字段和清理调用路径已定位，具体受影响片段清单在实施时固化。
- 验收与证据 24/25：明确校验层、离线专项、平台与真实调用限制。
- 交付与恢复 19/20：复用分支，记录上游变化；规格阶段尚无交付授权，后续用户已明确授权，见开头记录。
- 风险及限制 10/10：历史版本、Windows 树清理与注入 child 均独立约束。

没有阻塞性的产品待决策点。用户已认可上述范围与验收标准，并在首轮验证后授权顺便修复格式问题、提交及创建 PR。交付时同步 main 至 `a5a32835882deab5e2364b559dd06bf1675c1335`，复用原四个格式问题的上游修复，额外仅补 #267 三份文档的 frontmatter。最新通过结果见[验收记录](validation.md)及[双轴审查](review.md)。运行行为与 CI 范围约束不变。
