---
type: Journal
title: 待握手容量回归的成功路径验证
description: 记录 Issue 144 的本地验证、负向实验、代码版本及交付边界。
tags: [testing, stream, protocol]
---

# Issue 144 本地验证

用户已授权同步最新代码、实现、提交推送及创建 PR。实施基线为 `c35b261b31573bc2f08a16eeced12f18705b2560`，实现提交为 `20f67b3069c168669a9c2c10a27aa3abf0834ae0`。以下验证在该提交相同测试内容的未提交工作区执行，未修改产品源码。

环境：macOS 26.6.2 / Darwin arm64、Node v24.22.2、pnpm 11.19.0。原 Issue 的 Windows 证据未在本轮重跑，不用于推断本轮平台覆盖。

## 改动与验收

唯一测试改动为现有 `test/host-run-service.test.js` 的容量用例。夹具发送 running、带 runId 的 canonical final 文本和 completed 三帧；全部 128 次调用逐一核对回执身份、成功终态及完整连续回放。满载等待握手仍拒绝第 129 个请求。

固定 Date.now 保证所有旧帧在同一时刻写入；独立 performance.now 将轮询限制为 2 秒。TTL 119999 毫秒时所有输出可读且仍拒绝新调用，120000 毫秒时全部 get/read 报 RUN_NOT_AVAILABLE。fresh 随后被接纳，实际 completed 并保留正确输出；最终活动数与待接纳数归零。清理 hook 先释放 gate、等待接纳 settled，再关闭 Host。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，含 prepare 构建；依赖和锁文件无改动。 |
| `pnpm typecheck` | 通过，含全 workspace 构建及根 TypeScript 检查。 |
| `pnpm lint` | 构建完成后通过。首次与 typecheck 并行时，build clean 删除 dist 导致类型解析报错；已修正检查顺序，最终结果取构建后的运行。 |
| `node --test --test-name-pattern="Host counts pending handshakes" test/host-run-service.test.js` | 正确版本通过，1 项。 |
| `node --test test/host-run-service.test.js` | 还原负向变异后的最终版本通过，7 项、0 失败、0 取消。 |
| `pnpm exec prettier --check test/host-run-service.test.js` | 通过。 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过；最终文档检查数量以交付时结果为准。系统 Python 缺 PyYAML，临时 uv 环境未改仓库依赖。 |
| `git diff --check` | 通过。 |

首轮身份断言曾错误使用原始请求的 sessionId；检查 preparedSubmit 的转换后改为原始请求的 agentSessionId，后续正确版本通过。

构建中的 WebUI chunk 大小及 lucide 的 use client 提示为警告，构建退出 0；本任务未修改相关实现。

## 负向实验

每次只修改夹具一个条件，使用上述目标命令显式本地执行，随后还原。不增加专项脚本或默认开关。

| 临时变异 | 结果与失败原因 |
| --- | --- |
| 首帧 running 恢复为 accepted | 退出 1，终态断言发现实际 lost/seq 2，与期望 completed/seq 3 不同。 |
| 删除 completed 帧 | 退出 1，终态断言发现实际 lost/seq 4，与期望 completed/seq 3 不同。 |

两次失败均由成功终态断言捕获，不是导入或环境错误。变异已全部还原，最终整文件通过。

## CI 与验证边界

相对实施基线，`.github/`、package scripts、依赖和锁文件 diff 为空。已核对原 CI 的 Linux/macOS Node 24/26 构建测试打包矩阵、Windows 发行检查以及 PR 标题检查；不新增 workflow、job、矩阵、触发条件、步骤、必需检查或 Gate。仅加强已在 test:suites 中运行的现有用例；负向实验仅本地手动执行。

未运行全量 pnpm test、真实 Provider、模型、网络、IM 或 Windows 原生测试；本任务不改变跨包合同，验证集中于原有 Host 测试。托管 CI 的实际结果以 PR 为准，本地结果不替代 CI。代码审查记录见 [review.md](../../tasks/144-handshake-capacity/review.md)。不自动合并或删除 worktree。
