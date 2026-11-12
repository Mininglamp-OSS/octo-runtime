---
type: Task
title: Inputs 与 AgentEnv 开发参考专项
description: 基于最新 main 补齐输入与七个公共执行项参考并减少包文档重复。
tags: [documentation, invoke, context, agent-env]
---

# 目标与范围

基线 origin/main d63ad1fae599e0ab85a0ce24e01ed75db003ea60；独立 worktree inputs-agentenv-reference。按用户要求补充 inputs、信封、七个公共 item、显式配置组合及私有项边界；docs 维护公共细节，包 README 提供包职责与链接。

# 关键合同

公共项来自 context-catalog.ts，MCP 名称为 mcp（不是 mcps）。结构校验与 Adapter 消费校验分层；不更改执行语义或增加公共字段。私有项归所属 Adapter。中文与英文示例一致，不写凭据值。

# 验收

逐项核对 Schema、运行时校验、SDK helper 与 watchdog；检查双语链接、JSON 示例和知识元数据。专项验证仅本地显式运行，不修改 workflow、job、脚本默认范围或必需状态。提交、推送与 PR 按用户明确授权执行，当前授权见末节。


# 文档组织修正

按用户最新要求，七个公共 item 集中在同一个 agent-env-standard.md 中，采用 H1/H2/H3 层级，每项只组织示例、payload 定义和注意事项；删除此前拆分的公共 item 文件，保留 Adapter 私有字段参考及 modeId 区分。


# 当前文档边界

docs 只描述当前公开合同；历史基线、旧架构验收、迁移和兼容层叙述移出用户文档。CLI Manifest、模块加载、工厂参数和内部关闭合同属于 CLI/Electron/app 宿主实现，不新增对应参考页；删除模块装配页和三个重复渠道入口。继续整理 Inputs、输出、SDK API 与包 README 的职责与引用。


# 辅助 API 归属修正

按用户要求，AgentEnv 帮助函数作为标准参考的附属文档，文件为 agent-env/helpers.md。删除顶层目录中以 defaults/mandatory 命名的主题；这些名称仅在具体函数签名和参数表中出现，不作为 AgentEnv 标准字段、配置分层或运行时概念。标准项正文只维护条目行为，helper 的构造、读取和合并细节集中到附属 API 页。

# 审查与交付授权

用户于 2026-11-12 明确授权使用 code-review 审查本次文档并提交目标 main 的 PR，包含必要修复、英文 commit、推送工作分支和创建 PR；不包含合并或发布。作者保留 Git 配置，Codex 贡献按要求追加 trailer。审查基线为本次 fetch 后的 origin/main d63ad1fae599e0ab85a0ce24e01ed75db003ea60，覆盖全部暂存文档与新增文件，不只审查已提交的 HEAD。
