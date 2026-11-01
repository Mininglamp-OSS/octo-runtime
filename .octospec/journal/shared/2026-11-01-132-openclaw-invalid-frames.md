---
type: Journal
title: Issue 132 无效帧实施记录
description: 从坏帧断连建议调整为日志跳过，并验证共享 worker 后续可用。
tags: [openclaw, protocol, testing]
---

# 用户决定与实施

原 Issue 建议坏帧关闭连接，用户明确希望 null 后继续接收正常结果。已先更新英文 Issue 和 [规格](../../tasks/132-openclaw-invalid-frames/brief.md)，规划可执行性 96/100；用户“开始实施”后，基于 main `148d737d` 修改 Gateway 接收入口与 Adapter 日志传递。

解析结果先按 unknown 校验，仅对必要路由字段判定。无效消息采样诊断后 return，保留 socket、pending、原期限。诊断只输出固定原因和计数，未注入 sink 时尝试 stderr，不写 worker stdout。正常 RPC 失败、取消、断连及终态归一化沿用已有合同。

真实 loopback、独立子进程和真实共享 worker 的 29 项专项通过；相关回归 162 通过、1 GC 项条件跳过。双轴审查修复测试清理等待无期限问题后均无未解决项。完整命令及未验范围见 [验证](../../tasks/132-openclaw-invalid-frames/validation.md)和[审查](../../tasks/132-openclaw-invalid-frames/review.md)。

本次未提交、推送或创建 PR，未扩大 CI。进入验证审查，真实 Provider 及跨平台验收独立保留。

## 本地复审与补充验证

按用户后续要求重新执行 code-review 双轴与 verified-review。修正审查文档类型 Task 为 Review；没有新增产品缺陷。严格 unhandled rejection 模式下手动专项 29 项通过，开启 GC 后相关回归 163 项全部通过（此前跳过的 GC 项已补验）。构建、类型、lint、命名和知识检查重新通过。最终结果补充到 ORT-38 任务评论，工作区保持未提交，仍待验证审查。
