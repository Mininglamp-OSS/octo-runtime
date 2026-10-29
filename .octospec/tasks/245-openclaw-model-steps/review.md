---
type: Review
title: Issue 245 双轴审查
description: 按 code-review 技能审查 OpenClaw 步骤映射、最终正文及多版本兼容。
tags: [openclaw, review, testing]
---

# 范围

用户指定 `/Users/lvsijia/.agents/skills/code-review/SKILL.md`。两个独立审查 agent 分别负责 Standards 与 Spec。初审基线固定 `ba2a706380bf244bc428b3465c0487c5b58e6975`；当时分支 `fix/openclaw-model-steps-245` 无新增提交，因此实际审查 `git diff <baseline> --` 加新增手动测试/OctoSpec 文件；不把空的 three-dot diff 当作审查完成。后续已按用户授权提交并重基，当前审查范围见下节。

Spec 来源为 [Issue 245](https://github.com/Mininglamp-OSS/octo-runtime/issues/245)、[brief](brief.md) 和用户关于最终正文及 7.1 至最新正式版的澄清。Standards 来源为 AGENTS、CONTRIBUTING、OctoSpec 已读架构/协议/Adapter/reasoning/engineering/collaboration 规则及技能规定的完整 smell baseline。

## Standards

最终核心审查未发现代码规则违反或值得单列的 smell。过程 commentary、单一 final、7.1 元数据优先、延迟工具/flush 去重和固定准入表均留在 OpenClaw Adapter。既有 message-segments 只维护原有断言，新增验证均在手动目录，默认 fixtures、测试入口和 GitHub CI 未扩大。

复审发现 1 项文档同步问题：规则仍写支持到 10.5、共 27 个标签；已修正为 10.8、共 32 个，并链接本次固定合同证据。validation 和 review 已补齐最终正文合同、最新验证结果和未验边界。

## Spec

最终代码审查与 96 项专项复跑通过，未发现剩余可复现需求偏差。此前发现并修复：最终回包复用上一轮正文、多 block 持久正文重复、status-only 回执把显式 commentary 提升为 final、7.1 payload 丢失 reasoning 标记导致最终正文污染。分别增加了精确断言；显式空最终元数据也不回退为过程正文。

真实 7.1 验证中另外修复 text-only toolUse 的后续工具误开轮次，以及持久 stop 后同文 flush 生成额外轮次。7.1/10.8 新会话和原会话续聊、9.4 新会话均通过 3 step / 2 tools / 1 条精确 final 断言。

## 边界

旧版续聊无 runId 的 thinking-only/length 完成通知仍无法安全归属，保留明确降级，不冒认旧消息。初审时尚未全局安装，后续已授权安装并由用户确认 hello.md/world.html 最终正文符合预期；卡片 HTTP 400 用户明确由其他 PR 处理，完整卡片 UI 验收不能据此记为通过。安装与服务重启见验证记录。OctoSpec lint 有基线 Issue 137 的三份文档缺 frontmatter，非本次新增。

两轴收尾：Standards 剩余代码发现 0，Spec 剩余可复现代码发现 0；本地人工验收与旧版原生身份限制见 [验证](validation.md)。

## PR 244 合并后的复审

用户授权等待 #244 合并后交付；该 PR 于 2026-10-29T10:53:37Z 合并。当前特性已提交并 rebase 到最新 main `01d0ca5d3f62f1e9dc5999ed84da4797e9acafef`，生产与专项审查使用 `git diff 01d0ca5...ad29f39`。冲突处理保留 #234/#243 的目录条目，将 #243 远端转换 TODO 保留在新唯一 final 出口，没有恢复旧的重复 final 消息。

Standards 独立复审未发现代码规则违反或实质 smell，仅指出初审范围及安装状态措辞过时，已在本记录区分历史与后续事实。配置作者、英文 commit、单次 Codex trailer、CI/default suite 范围均已核对。

Spec 独立复审：缺失/部分实现、需求外范围、错误实现均为 0。相对原特性提交的 Adapter 差异仅保留 #243 两处 TODO；#244 的 providerInputText/initialControlInstructions 及共享续接校验不变。主 agent 复跑构建/类型、静态检查、96 项专项、198 项既有回归及本机 9.4 Playboard 全部通过，详情见 validation。本地两轴审查不作为 GitHub 正式 Approve 票数。
