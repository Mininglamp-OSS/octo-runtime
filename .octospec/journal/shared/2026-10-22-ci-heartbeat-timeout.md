---
type: Journal
title: Worker 心跳集成测试超时修复验证
description: 记录发行 CI 的失败证据、测试预算修正与实际验证结果。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
source: self
---

# Worker 心跳集成测试超时修复验证

## 失败证据

[发行 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39728349001/job/119657454399) 的 Ubuntu / Node 26.12.1 在 `test/kernel-worker-supervision.test.js:41` 等待替代 worker 就绪超时。
Node 共 1522 项，1487 通过、1 失败、34 跳过；其他五个矩阵环境通过，同一提交的 main CI 也通过。
错误仅说明未在用例的 7 秒窗口内完成替换，不能据此断定 Node 26 兼容性故障或实际恢复失败。
修改前本地 Node 24 单跑通过，体现该问题对调度和计时敏感。

## 实施

测试分别验证故障检测和新进程就绪，保留精确时钟的心跳截止回归，并新增旧 PID 回收与新进程 RPC 断言。
不修改生产代码，不删除用例、不增加失败重试、不跳过 Node 26。
类似测试应分别验证协议截止、资源回收及启动就绪，不能把一个阶段的预算直接作为所有阶段的总预算。

## 验证

- 初步本地 Node 24.19.0：目标两文件 10 通过；完整 Node 测试 1489 通过、34 跳过，UI 35 通过。
- 独立 worktree 的 Node 24.19.0 与 Node 26.12.1 同时运行完整 Node 测试，各 1489 通过、34 跳过；Node 24 的 UI 35 通过。
- 同时使用 Node 26.12.1 顺序重复目标用例三次，全部通过；三次用例耗时约 11.8 秒，其中约 5.5 秒为空闲健康等待。
- 两个测试文件的 Prettier 检查与 `git diff --check` 通过。
- 远端跨平台 CI 结果以对应 PR 检查为准，不将本机 macOS 结果视为 Linux/Windows 实测。

用户要求提交 PR 并合入 main；本次不移动或重新创建已存在的 v1.1.1 tag，不触发发行发布。
