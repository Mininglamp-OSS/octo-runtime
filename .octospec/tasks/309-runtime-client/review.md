---
type: Review
title: Issue 309：Standards 与 Spec 两轴审查
description: 记录按用户指定 code-review 技能执行的独立两轴审查、三项规范修复及最终结论。
tags: [review, architecture, packaging, release, testing]
---

# 两轴审查

用户显式调用 `/Users/lvsijia/.agents/skills/code-review/SKILL.md`。分别由两个只读子代理执行 Standards 和 Spec 审查，不混合排序结论；随后按修复后的文件复核。

固定基线为本次新 worktree 起点 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，与 HEAD/origin/main 一致。没有本次提交，`git log de3ff37a..HEAD --oneline` 为空，因此有效审查命令为 `git diff de3ff37a --`，并逐项读取 `git ls-files --others --exclude-standard` 中新文件；不把三点 HEAD 空 diff 当作没有改动。

技能引用的 `docs/agents/issue-tracker.md` 不存在，已告知用户可用 `/setup-matt-pocock-skills` 补齐；本次已有明确 issue URL 与[用户确认设计](design.md)，直接以它们审查，不引入无关配置改动。

## Standards

标准来源：用户 GitHub CI/提交授权约束、AGENTS.md、CONTRIBUTING.md、适用的 OctoSpec 架构/工程/协议/执行规则，并使用技能给定的代码异味启发式；仓库明确规则优先，格式/lint 交给既有工具。

| 初审发现 | 规则与影响 | 修复和复核 |
| --- | --- | --- |
| 手动发布夹具硬编码 NPM_TOKEN 占位值 | 架构凭据规则要求测试值运行时生成 | 改用 randomUUID，并清空子进程继承的 npm/GitHub 认证变量；复核关闭 |
| client 入口注释仍写“只在 CLI 模式显式 attach” | 架构明确 attach 面向独立应用，关键注释不能描述错误责任 | 改为独立应用显式连接、原生服务宿主用 kernel.client；复核关闭 |
| 基线测试 finally 在 close incomplete 时仍删除目录 | 生命周期规则要求保留未确认清理事实 | close 完整成功后才 rm，失败含保留路径诊断；复核关闭 |

复核认为：旧 Kernel 转发是明确兼容要求，不构成需移除的 Middle Man；global verifier 仅复用现有 npm pack 解析器，未扩大验证场景；基线测试从固定 SHA 源码编译，不借用当前服务实现；未见 CI 扩围、client 反向服务依赖或有实际影响的其他 smell。

**最终 Standards：累计发现 3 项，全部修复，剩余 0 项。**

## Spec

以[简报](brief.md)、[设计](design.md)、[计划](plan.md)、[验收](acceptance.md)和 issue #309 为需求依据；用户后续确认的“双份自包含发行物，跨副本值身份不保证”优先于 issue 原先的跨发行物 === 方向。

已核对唯一客户端/调用登记/错误证据实现、Node/protocol 依赖闭包、full 包内 client/protocol、旧 API 和 Extra direct/IPC、两包预检、上传 ACK 未知确认、构建时间恢复、附件补缺/一致性与三 latest 不回退。未发现缺失、超范围或错误实现的可确认问题。

追加复核确认：归档 exports/schema/build-info 检查补齐 A01；固定基线互操作测试具有独立来源；global verifier 适配没有新增默认检查。最终执行结果见[验证记录](validation.md)，不能把规划 95 分视为交付完成率。

**最终 Spec：0 项已确认问题。**

本次审查与运行验证仅覆盖本地源码和归档；平台、真实 Provider/Electron、正式权限与发布仍受验证记录的未验边界限制。未提交或发起远端 review。
