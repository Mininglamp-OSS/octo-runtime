---
type: Validation
title: Inputs 与 AgentEnv 文档专项验收
description: 记录字段来源、文档验证结果与未运行边界。
tags: [documentation, validation, agent-env]
---

# 基线与交付

基线 origin/main d63ad1fae599e0ab85a0ce24e01ed75db003ea60；分支 codex/docs-inputs-agentenv-reference；2026-11-12 macOS 本地文档修改。无 commit、push、PR 或发布。未修改运行时实现、Schema、生成类型、默认测试开关或 CI。

# 覆盖

- 新增双语 inputs 参考，重写 InvokeInput/InvocationContent/ProviderSession 字段说明。
- 七个公共执行项合并在同一 agent-env-standard.md，采用 H2 item 与 H3 示例/Payload/注意事项；另有显式配置组合及私有项导航。
- 专属页覆盖 Codex、Claude Code、共享 ACP 各实现、Grok Build、OpenClaw、DSH；CodeBuddy/Antigravity 不误授共享 modeId 支持。
- modeId 明确为工作模式 ID，不是模型 ID；模型字段为 octo.execution/model.payload.selection.id。
- 包目录补全 Adapter 导航，相关 README 通过链接引用公共与包维护的专属参考，去除重复的私有模式说明及工作目录/提示词迁移正文。

# 验证

- pnpm install --frozen-lockfile --ignore-scripts：通过；仅安装 worktree 依赖。
- pnpm build：通过，生成文件无 diff。
- pnpm docs:check：通过，46 对双语页面、93 个 Markdown 文件、44 个 JSON 示例、7 个公共项；4 项既有接入示例测试通过。AJV 对历史 date-time format 提示不影响检查。
- node scripts/check-developer-docs.mjs --scope current：通过，覆盖当前文档和包 README 的链接与锚点；最终计数见收尾命令输出。
- 手动将 reference 中 9 个公共 payload 示例逐个通过 Schema 与 assertAdapterAgentEnv 消费校验：通过。私有字段逐项对照对应 Adapter 实现，不把公共信封结构通过当作私有字段已生效。
- python3 .octospec/scripts/lint.py 初次缺少 pyyaml；改用 uv run --with pyyaml python .octospec/scripts/lint.py 完成，未修改项目依赖。
- git diff --check：通过。
- git diff origin/main -- .github：空；未增加 workflow/job/矩阵/触发器/必需状态，未修改 package.json 或验证脚本范围。

# 证据边界

纯文档专项未运行真实 Provider、IM 或全量运行时测试，不声称重新验证上游版本行为。参考描述绑定当前源码合同；部署、认证和 Provider 版本差异由宿主与实际环境确认。

文档接入可执行性自评 98/100：2 分差距为私有字段的 Provider 原生行为没有本轮逐个真实联调；字段和校验已与当前实现逐项核对。该评分不替代真实验收。


# 用户修正后的复验

删除 14 个公共 item 拆分页；中英文 agent-env-standard.md 各自包含七项完整参考。修正所有引用并重新运行 docs:check、当前文档链接检查、OKF lint 与 git diff --check，不改 CI 或默认检查范围。

按用户命名要求，公共参考文件改名为 agent-env-standard.md，中文标题为“AgentEnv 标准参考”。既有文档检查脚本仅同步受检文件路径，原有检查项和范围保持不变。

改名后 pnpm docs:check、OKF lint、git diff --check 通过。--scope current 仅枚举 Git index，在尚未暂存的改名状态仍读取已删除旧文件；本次显式调用同一 auditDocumentLinks，以工作树实际存在的已跟踪/未跟踪文档检查链接，覆盖新文件，不改变检查脚本范围或暂存状态。


# 当前公开文档整理复验

用户确认 docs 只展示当前公开合同；CLI Manifest、模块加载、工厂参数与宿主内部关闭方式不作为 SDK 用户参考。移出中英文模块装配页和三个重复渠道入口，保留 Gateway 的独立仓库链接。维护页的旧版本/旧架构验收记录归档到 journal；.octospec 历史保留，受影响的链接固定到源码版本，任务 85 的关联设计标记 historical。

Inputs 按文本、图片、主输入与恢复输入整理示例、payload 和注意事项；KernelClient 方法与返回值移到独立 SDK 参考，kernel-ipc 只维护 wire 合同；CanonicalEvent 23 类事件、HostFrame 与 control payload 集中到输出参考。protocol/client README 保留最小用法和主题链接，清除迁移与兼容层叙述。

本轮 pnpm docs:check 通过：43 对双语页面、87 个 Markdown、48 个 JSON、6 个 Mermaid、7 个公共标准项，4 项现有 SDK 示例测试通过。工作树链接审计通过：173 个当前文档、1953 个链接、40 个锚点、0 错误。OKF lint 通过：774 个知识单元、20 条规则、3808 个本地链接；git diff --check 通过。最终文字调整后再次复核文档和元数据。

相对 origin/main 的 .github、package.json、pnpm-lock.yaml 无变更。检查脚本仅同步改名后的参考路径，不增加检查范围。未修改运行时实现；没有真实 Provider 执行、提交或推送。

最终复验通过：docs:check 仍为 43 对页面、48 个 JSON、4 项示例测试；新增输出示例的 10 个事件及 2 份文本输入通过运行时语义校验，事件集合确认为 23 类。README 压缩后工作树审计为 173 文档、1937 链接、40 锚点、0 错误；OKF lint 为 774 单元、20 规则、3794 本地链接。git diff --check 通过，CI 与依赖清单相对目标分支无变更。

# AgentEnv 辅助 API 归属复验

按用户修正，将 configuration.md 改为 agent-env/helpers.md，并从 AgentEnv 标准参考的附属 API 入口进入；删除顶层 docs 目录和 protocol README 中 defaults/mandatory 主题。标准条目正文不再混写函数参数分层；这些名字只在具体 helper 签名和入参定义中保留，构造、读取与合并行为均对照当前实现。

pnpm docs:check 通过，43 对页面、48 个 JSON、4 项现有示例测试。构造、读取、合并、输入不变性与 resolveContextConfiguration 参数行为的显式本地检查通过。工作树链接审计为 173 文档、1931 链接、40 锚点、0 错误。OKF lint 通过，774 单元、20 规则、3788 本地链接；git diff --check 通过。仅文档组织和示例调整，未改变运行时或 CI。

# PR 前审查与复验

用户授权 code-review、commit、push 和 PR -> main。Standards 与 Spec 独立审查发现的两个 P3 文档问题已修复并分别复核，无剩余发现，详见 review.md。

修复后 pnpm docs:check 通过（43 对页面、48 JSON、4 项示例测试）；node scripts/check-developer-docs.mjs --scope current 通过（173 文档、1931 链接、40 锚点、0 错误）；node --test scripts/checks/developer-doc-links.test.mjs 的 11 项测试通过；OKF lint 通过（775 单元、20 规则、3788 本地链接）；文档检查脚本 Prettier 检查和 git diff --cached --check 通过。

暂存路径审查确认：除 Markdown 外仅包含本任务 context.yaml 与文档检查器的一行参考路径更新。核心实现、Schema、生成类型、依赖、默认测试和 workflow 均无变更。英文提交与 PR 使用 Git 配置作者并保留 Codex trailer；本授权不包含合并或发布。
