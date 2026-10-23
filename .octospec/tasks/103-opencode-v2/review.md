---
type: Task
title: Issue 103 OpenCode 2 双轴审查
description: 固定 main 基线的 Standards 与 Spec 独立审查结论和验收边界。
tags: [adapter, testing, protocol]
timestamp: 2026-10-23T05:00:00Z
---

# 审查范围

基线为 `445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`，实现提交为 `81f316e88c324e374b613dc6a12437da130fa5ff`；差异使用 `git diff 445d2bb24f6ffc27bb4414c835e6a0b365f9f25b...81f316e`。两个独立审查分别对照仓库规则与 Issue #103 / 最终任务简报。其后补齐验收记录，并对 PR Secret Scan 的固定无效凭据样例误报完成修复和独立收尾复核。

## Standards

未发现需要修复的问题。ACP 仅在关闭成功后归一普通执行错误，结构化错误和清理错误保留；CLI 以真实退出码判定成功，不由 step_finish 提前成功。环境、cwd、配置和临时资源归属符合仓库合同。提交保留配置的作者、英文消息和 Codex trailer。Fowler smell 检查无可操作发现。

## Spec

未发现需要修复的问题。V1 在 probe 和直接 invoke 均明确拒绝；两传输共用实际路径门禁。CLI 的 standalone、stdin、model/effort、V2 MCP 和退出检查符合合同；ACP 保留原生 deny，未应用的 effort 明确提示。16 个真实执行及独立 worker 的测试 IM 往返覆盖本次主要需求，共享 SDK/ACP 改动直接服务兼容与清理问题。

## 验证与剩余边界

实际检查结果和首轮高并发计时失败的复核过程见 [validation](validation.md)。最终 Node 全量 1674 通过、40 跳过，UI 35 通过，相关回归 84 通过，工程检查通过。OctoSpec lint 仍有 3 个已确认基线缺少 frontmatter 的错误，与本次变更无关。

真实集成仅覆盖 macOS arm64 / OpenCode 2.1.3 / deepseek/deepseek-flash；Windows/Linux、其他 2.x 和其他模型未实测。ACP effort setter 未实现；CLI 缺少显式 model 时不猜测模型引用。审查未将这些已公开的范围边界认定为本次阻断问题。

Standards：0 个发现；Spec：0 个发现；两个轴均无待修复问题。

## PR 收尾复核

远端 review 在 ad4e357 提出唯一 P2：固定无效 apiKey 样例造成 Secret Scan 失败。首次修复简化固定值，为真实原始历史指纹添加单条例外，同步命名检查的规范化 SHA256；错误认证语义保留，16 个真实场景再次通过。独立 Standards 审查还发现需同步该哈希，已修正并通过命名检查与 7 项回归，最后复核无剩余问题。完整历史及 PR canary 证明原行和邻行的新模式仍被拦截，具体证据及既有历史告警边界见 [validation](validation.md#pr-secret-scan-误报核验)。

用户随后明确凭据值及固定测试占位值禁止入库；首次扫描修复不代表满足这项设计约束。已补充架构规则，并将错误认证值和 MCP Authorization 值均改为运行期在内存随机生成，撤回保留固定值的做法。最终验证及托管重新审查状态分别见验收记录和 PR 最新结果。
