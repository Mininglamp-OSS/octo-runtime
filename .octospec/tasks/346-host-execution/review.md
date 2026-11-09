---
type: Review
title: Issue 346：双轴代码审查
description: 记录 Standards 与 Spec 独立审查、问题修复及复核结果，不以规划评分代替证据。
tags: [architecture, adapter, review]
---

# 方案自审

以下为初始方案自审；后续用户授权实施与独立 code review，结果见下文。

| 检查 | 发现及处置 | 状态 |
| --- | --- | --- |
| metadata 是否足以存依赖 | 现有 metadata 是注册与输出描述，providerPath 是 probe 结果；设计禁止反向配置，改为复用工厂参数/CommandSpec/provider | 已在 design 明确 |
| 只固定 executable 是否足够 | Windows resolveProcessLaunch 仍可能选择相邻/其他 Node；增加宿主绑定 runtime + 前缀 argv，底层不再重新搜索 | 已列 M1、A04/A10 |
| probe 与执行是否同源 | OpenCode 每轮查找、Codex probe 使用默认环境；要求 probe/执行/恢复同一绑定，仍保留版本校验 | 已列 A02/A06/A07 |
| 缺安装是否导致全 CLI 停机 | 删除默认实例会使 factory 缺依赖；由 CLI 静态 metadata + defineAdapter 构造 unavailable 包装，区分配置形状错误与安装缺失 | 已列 A11/A12 |
| 强制 client-only/统一构造是否越界 | 普通命令可使用显式启动描述；Codex 专用 provider 保持，ACP 复用 factory；不推广统一 Engine 合同 | 已在 brief/design 明确 |
| 协议功能是否误删 | OPENCODE_CONFIG_CONTENT、工具 PATH、MCP、envs 继续传递；只禁止自动重选 Provider/runtime | 已列 A05/A14 |
| 是否把远程当成本地路径 | factory/provider 封装位置，本机不 stat；真实远程和任意 client 结构兼容不宣称已实现 | 已列 G1、A09 |
| 生命周期是否过度统一 | 本轮 transport 可受委托 spawn/close；共享 engine 只由 owner 最终关闭，Home 独立 | 已列 A07/A08/A13 |
| 是否遗漏独立实现 | Grok adapter/client、CodeBuddy、Claude、Antigravity、DSH/OpenClaw 单列，不只修改标准 ACP | design 逐类表覆盖 |
| 是否挟带 CI 或远端交付 | 仅文档，专项拟放 test/manual；无 workflow/default selector 修改，无提交/推送/PR | 交付时由 validation 记录实际 diff |

剩余风险及四分缺口见 [assessment](assessment.md)。上述“已明确”只表示规划已补齐，不代表相应测试已经通过。

## Standards

使用 code-review 技能的独立 reviewer，以 main@c7ae0256 加当前未提交及新增文件为范围，依据 AGENTS 与工程/架构/环境/本地执行/生命周期规则审查。当前 0 项未关闭 finding，无需单列的代码异味。

已修复 POSIX Electron 错误优先搜索 cwd/node、读取 shebang 误拒绝 execute-only 原生程序、无扩展名 Node 入口随请求 PATH 换运行器，以及 Node 前缀入口损坏时 probe 假可用。独立执行相关 3 项专项、模拟 Electron PATH 分支和 diff/CI 核对通过。复杂 Node shebang 参数要求显式注入，避免丢失参数。Windows/Electron 实机未验。

## Spec

另一独立 reviewer 依据 brief/design/plan 及用户“无兼容层、CLI 发现 executable”指令审查。当前 0 项未关闭 finding。

已修复 unavailable Adapter 的拒绝 iterator 导致 Core 清理永久 incomplete（P1），以及 ask/native 提前误报审批能力不足（P2）。采用 async generator 和 runAdapterPreparation 确认无 Provider 资源，responder 只拒绝无活动请求。Core 四种受支持协议/审批组合均报告依赖失败且 cleanup complete。

失败目标、ENOENT/EACCES 分类、启动链与探针同源问题、helper 子路径和 live fixture 重复导入均已修复。Reviewer 独立重跑 #346 的 12 项全部通过，并检查两份 live fixture 语法。metadata/schema、单 owner 生命周期及 CI 范围符合约定。

真实 OpenCode ACP 另暴露并修复基线 diagnostic severity 与协议不符；专项 assertCanonicalEvent 和真实重跑通过。当前 Standards 0、Spec 0，两轴无未关闭的最高严重问题；最终检查和真实环境边界见 [validation](validation.md)。
