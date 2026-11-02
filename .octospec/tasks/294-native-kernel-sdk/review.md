---
type: Review
title: Issue 294 本地双轴审查与 SDK 接入章节修订
description: 按规范与需求分别审查原生 Kernel 迁移，记录两项生命周期修复及 SDK 文档分章结果。
tags: [review, architecture, lifecycle, sdk, documentation]
---

# 审查范围

2026-11-02，基线 `58332b3bcf5651f58e674fa236184dc6a0d927ca`，HEAD 等于基线，无新增提交。审查 `git diff 58332b3bcf5651f58e674fa236184dc6a0d927ca --` 及未跟踪的新源文件/任务文档，覆盖当前工作树。采用 code-review skill 的 Standards/Spec 双轴独立审查，再复核和修复；本地 brief、plan、架构规则及当前用户补充是需求来源。

## Standards

**1 项 P2，已修复：真实清理失败被活着的宿主掩盖。** 原生 Adapter finally 抛错后，`kernel.close()` 为 incomplete，但 `inspectOrphanCleanup()` 因 owner PID 仍活着报告 available。已实际复现 `cleanup:false, phase:failed, recovery:available`，违反“未完成的实际操作仍为 incomplete”的生命周期规则。

资源记录新增可选 `cleanupFailed` 区分运行中保守标记和已发生的关闭失败，保持 schemaVersion 1。Kernel 在共享关闭截止内登记失败；持久化错误不覆盖原错误。健康原生 owner 仍 available，真实失败显示 cleanup_incomplete；人工确认仍拒绝活 owner。最终按用户决定拒绝旧 worker 格式，不再保留旧恢复路径。回归覆盖正常、失败、旧格式拒绝和确认边界，见 [关闭测试](../../../test/host-process-close.test.js)。

未发现其他可确认的硬标准违反或值得单独阻塞的代码异味。RPC 分层和同进程对象注入属于明确架构要求，不按一般转发层异味删除。

## Spec

**1 项 P2 代码问题，已修复：关闭未等待实际在途的 probe。** 原生 `adapter.list` 经 Core 调用 `adapter.probe()`，原实现仅追踪 Run；`describe()` 超时后真实 Promise 仍可使用宿主依赖，而 close 已返回 complete。已用 gated probe 复现 `complete:true, probeFinished:false`，违反宿主依据清理结果关闭依赖的顺序。

Core 登记实际 Promise/thenable，describe 走同一 probe 入口；shutdown 在原预算内等待，仍在途则 incomplete，关闭后拒绝新 probe。保留 Adapter this、同步值/异常和 thenable 单次消费；正常拒绝会释放在途记录。probe 不属于 invocation，不伪造遗留 invocationId。回归见 [Kernel 测试](../../../test/kernel-invoke.test.js)和 [Core 测试](../../../test/executor-core.test.js)。

**1 项接入文档偏差，已修订。** 原 SDK 页并列 attachKernel 和原生接入，且把 AgentRun invoke 混进快速接入。按用户补充，显式 attach 只在 CLI 模式跨进程接入说明中展示；原生宿主使用 kernel.client，Extra 内部管理自己的 RPC client。

文档现分为三个页面：

1. [SDK 服务接入](../../../docs/zh-CN/getting-started/sdk.md)：KernelService 与 ChannelGateway ExtraService 分章，只有服务装配、初始化、状态和关闭。
2. [高级依赖](../../../docs/zh-CN/guides/sdk-dependencies.md)：loadContexts 的内存/文件场景、createSessionStore 的宿主存储工厂、自定义 Extra 模型目录函数；明确 Gateway 仅声明两个公开依赖。
3. [可选 AgentRun 使用](../../../docs/zh-CN/guides/agent-runs.md)：invoke、事件、交互和取消，非接入条件。

Adapter 工厂盘点：14 个内置 Adapter 中 9 个已有专用 create 工厂；Hermes、Kimi Code、MCode、QoderCLI、QoderCLICN 导出默认 ACP 实例。本轮未把“是否全部已有工厂”的询问解释为新增工厂授权。

## 验证与边界

双语文档、示例类型检查、Core/Kernel 定向回归、构建、lint 和根类型检查已执行；最终全量结果见[验证记录](validation.md)。未执行真实 Electron、Provider、线上 IM 或原生 Windows/Linux 验证。首轮 review 时尚未提交；后续按用户授权提交并创建 PR #295，没有变更 CI 范围或发布。

## 删除旧架构后的复核

用户明确不提供兼容或升级后，再次交叉检查原生所有权记录、真实 RPC 测试、执行源接口和验证脚本。旧 WorkerRpc、心跳、进程身份回收及旧日志白名单全部删除；旧格式和损坏资源记录明确拒绝并保留原文件。原生异常退出的摘要确认、活 owner 拒绝、实际清理失败诊断继续有效。Spec 轴未发现新增可确认问题。

Standards 轴发现并修复 2 项 P2 验证脚本问题及 1 项 P3 文档偏差：IM 重试专项使用当前 KernelClient.invoke/cancelInvocation，保留取消跟踪；关闭失败仍执行 HTTP 清理并聚合原始失败和清理错误，未确认回收时保留工作目录；生命周期规则删除旧 worker 日志兼容声明。复核无新增发现。脚本仅做语法验证，不将这些修复标为线上 IM/真实 Codex 已通过。

Standards：1 项 P2 已修复；Spec：1 项 P2 代码问题及 1 项接入文档偏差已修订；当前没有未处理的已确认 finding。
