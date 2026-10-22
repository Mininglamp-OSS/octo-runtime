---
type: Journal
title: CI 生命周期竞态修复与验证
description: 记录恢复 fixture 通知竞态、Windows 身份查询测试隔离及实际验证范围。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
source: self
---

# CI 生命周期竞态修复与验证

## 依据与修复

基线 `main@88fa71d`，独立 worktree `octo-runtime-ci-lifecycle-races`。
[macOS Node 26 失败](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39732869529/job/119671741690)为恢复用例启动次数 `5 !== 6`。
fixture 原来先记录启动，再检查故障文件；测试读到记录后立即恢复环境，可让本应失败的第五次启动直接就绪。
现在先确定 blocked 结果再发布记录，并逐次断言初始成功、四次失败和最后一次成功；两次 15 秒慢恢复间隔仍精确验证。

确定性交错探针在 appendFileSync 返回前删除故障文件：旧 fixture 没有按故障退出，最终由探针 SIGKILL；新 fixture 以 78 退出，记录 blocked=true。
探针只在临时路径运行，未加入产品或更改退避时长。

[另一轮 Windows Node 24 失败](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39731913784/job/119668645767)仅显示登记轮询 15 秒超时。
原始启动拒绝已被用例吞掉，因此不能确认底层原因。现在提前传播 initialize 原始失败，失败断言显示 cleanup 内容，同时验证取消原因。
Windows CI 将身份清单与启动回滚放入独立串行步骤，减少与进程密集用例竞争；真实 PowerShell 身份查询仍执行，未增加预算或跳过测试。

## 本地验证

- Node 24.19.0 和 26.12.1：目标四个测试文件各 16 项通过；完整 Node 测试各 1489 通过、34 跳过；UI 35 项通过。
- typecheck、lint、format:check 通过。
- 首轮本地验证错误地将 typecheck 的清理构建与测试并行，造成 dist 缺失；该轮受影响测试与 lint 作废，在构建结束后重跑通过。
- OKF lint 命中既有 `已退出的文档目录仍存在: docs`，本次未改变该目录策略。

远端矩阵及合并结果待验证；本轮不发布 npm 或变更 tag。
