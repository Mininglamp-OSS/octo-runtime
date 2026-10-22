---
type: Task
title: Worker 心跳集成测试偶发超时修复
description: 分离心跳检测与真实进程恢复的验收预算，保留精确截止及进程回收验证。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
slug: ci-heartbeat-timeout
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39728349001/job/119657454399
---

# Worker 心跳集成测试偶发超时修复

## 目标与范围

基于最新 `main@a7eda0c`，修复 v1.1.1 发行验证中 Ubuntu / Node 26 的偶发测试超时。
工程测试负责验证已有恢复合同；本次仅调整测试，不改变宿主决定权、公共 API、运行时心跳或恢复策略。
不涉及服务拓扑、数据、凭据、Provider 或其他接入产品的行为。

## 原因与合同

- 原用例等待替代 worker 就绪最多 7 秒，并断言总恢复耗时小于 6.5 秒。
- 每秒轮询、固定 5 秒心跳截止及 timer 精度意味着发现失联可能需要约 6 秒；随后仍需回收进程、250 ms 退避及启动握手。原测试将整个恢复过程误限为心跳预算。
- 可控时钟验证 5 秒固定截止，补充略早于截止的 timer tick 不提前过期、下一次 tick 不延长截止的回归。
- 真实进程测试分别等待进入 recovering（8 秒）和替代 worker ready（15 秒）；验证 PID 更换、一次重启、旧 PID 已不存在及新 worker RPC 可用。
- 保留空闲 worker 健康验证及 Windows 的 SIGUSR2 跳过条件；失败时输出清理前状态。

## 验收

- Node 24/26 的完整测试及目标用例重复运行。
- 格式检查、diff 检查及 PR 的跨平台 CI。
- 提交和 PR 使用英文，保留配置的 Git 作者及 Codex trailer；CI 成功后合入 main。

验证结果见 [journal](../../journal/shared/2026-10-22-ci-heartbeat-timeout.md)。
