---
type: Journal
title: Issue 145 公共 SDK 文档合同对齐
description: 文档及手动验证完成，记录模式、覆盖、容量和既有全库检查失败。
tags: [documentation, protocol, adapter, testing]
timestamp: 2026-11-01T02:30:00+08:00
---

# 结果

从 `f7384fcbc63b3392af6972c0da6e756bee80ac60` 的独立 worktree 完成公共 SDK 文档及注释修正。签名使用 `attachKernel({ endpoint })`；公共 `protocol_mode` 与内部 `protocolMode` 区分；canonical 转换要求限定到所选模式，native-only 不要求转换。环境规则改为 mandatory 最后按 key 覆盖，IPC 文档明确全 Kernel 共享 16 个并发订阅，与 64/32 连接限制分开。

确定合同直接回写当前 guides、environment 规则及就近接口注释，没有为历史记录增加第二套权威合同。

# 证据

新增 `scripts/manual/145-sdk-protocol-contracts.mjs` 与同目录 fake worker，仅显式本地执行，不接入默认测试或 CI。最终 8 项通过，覆盖中英 README 真实提取/strict 编译/运行、事件与封套、native-only、mandatory、旧字段拒绝、两个真实 Kernel Run 共享容量及释放，以及失败清理与错误传播注入。

类型/构建、文档 4 项、lint、命名、格式通过；相关回归 70 通过、1 Windows 条件跳过。双轴审查发现的手动 harness 清理与 ACK 后错误传播问题均已修复，复查无剩余问题。

全库 OKF lint 仍因 7 个基线文件缺 frontmatter 失败，不能报告整体验证通过。按 devflow 返回待规格审查；未提交或推送，没有 PR。详细命令、代码版本、日志及未验证边界见 [验证记录](../../tasks/145-sdk-protocol-docs/validation.md)，审查依据见 [双轴审查](../../tasks/145-sdk-protocol-docs/review.md)。

# 后续授权与主线同步

上述失败为首次实现阶段事实。用户随后授权补强 workflow 的 YAML 元数据强制要求、补齐 7 份历史文档，并要求任务分支提交、同步 main、创建 PR。任务提交 `1c1909d1` 后合入最新 `origin/main@db427e85`，合并提交 `8c95ea70`；解决知识索引、日志与元数据冲突，保留主线信息及正确文档类型。

合并后构建/类型、文档 4 项、手动专项 8 项、相关回归 70 通过加 1 平台跳过、lint、命名、格式及全库知识检查全部通过。知识检查为 541 个单元、20 条规则和 3428 个链接；双轴复核各 0 项，当前交付记录已更新。CI/依赖/默认入口相对 main 无 diff，当前准备按用户授权推送并创建英文 PR，不合并或发布；最终 PR 引用与提交版本写入 Loop 交付评论。
