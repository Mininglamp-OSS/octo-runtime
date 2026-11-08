---
type: Validation
title: client-release-version 实际验证
description: 记录成功检查和未完成的外部发布条件。
tags: [validation, release]
---

# 实测与边界

2026-11-08：Runtime 发布器本来就接受 1.1.12，源 manifest 为 0.0.0，未发现强制 2.0.0 的产品代码；本分支修正工程目录中 client 2.x 的错误约束，并在架构规则与双语维护文档明确 npm/IPC 版本独立。历史候选测试记录保留，其 2.0.0 不再是发行要求。无兼容层、无接口回退。

pnpm install --offline --frozen-lockfile（包含完整 build）通过；node scripts/pack-release.mjs --version 1.1.12 通过，完整 Runtime 与独立 client 归档内 version 都为 1.1.12。docs:check 的类型/文档和 4 项真实本地 Kernel 示例通过，Octospec lint 与 diff --check 通过。Gateway 独立版本分支使用这些归档完成 572 通过/1 跳过回归与三归档消费者验证。

这是本地候选验证，不是 npm 发布。未创建 tag、未改已有 draft release、未推送 npm。未来正式发行以 main 上的 approved commit/tag 为来源，并由 Gateway 刷新正式锁。
