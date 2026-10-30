---
type: Validation
title: Manager 凭据与独立 REST 的本地验证
description: 基线阻塞复现、实现验证和未执行范围。
tags: [channel, delivery, testing]
timestamp: 2026-10-30T02:00:00Z
---

# 本地验证

平台 macOS，Node 24.22.2；本轮初始源码 1878df7，实施期间已有另一条提交 0ccd077 修正 recovery-dual-mode 的瞬态状态观察，本轮保留并纳入验证。未修改运行中 Extra、宿主配置或全局安装。

## 已完成

- 更改前已编译实现：在真实 ImRuntime/GatewayTransport/OctoConnector 路径挂起旧 WS close，断线后调用 replyFailure；断言 REST 无需等待 WS 失败，实际请求被 verificationPending 阻塞。边界仅 HTTP/WS 和计时器使用 fixture，不是真实线上复现。
- workspace `pnpm build` 通过；最后的 Bot 字段初始化补充后 gateway 包重新构建通过。
- 根 TypeScript no-emit、仓库 ESLint、命名检查、所有改动源码/测试格式及 git diff whitespace 通过。
- `node --test --test-concurrency=2 test/im-*.test.js test/channel-*.test.js test/gateway-*.test.js`：596 通过，0 失败。既有用例按新合同更新断言，测试数量不变。
- `node --test test/recovery-dual-mode.test.js`：CLI/SDK 两种嵌入路径共 2 通过，0 失败。
- `node --test .octospec/tasks/channel-rest-manager-credentials/regression.mjs`：7 通过，0 失败，仅手动运行。覆盖 profile/POST 从 owner 读取持有值、缺失/畸形凭据不请求、401/403 不刷新或重放、429 使用 owner 持有值、附件 presign 使用有效值及 PUT 不携带 token；所有 REST 专项确认没有额外调用宿主凭据来源。
- 合计 605 通过。未新增默认测试入口、workflow/job/矩阵/触发或必需检查；相对 main@4e607dc 的 .github、scripts、package.json diff 为空。
- OctoSpec 全量 lint 已执行：4 处已有文档缺 YAML frontmatter（Issue 137 的 brief/review/journal 与 Issue 246 的 validation），本轮新增/修改文件没有错误；未扩展修改这些无关文件。

## 边界

本地 fixture 证明客户端序列化、生命周期与取消行为，不代表在线鉴权或真实网络切换验收。未重跑真实 Wi-Fi/Provider/IM，未运行全仓所有测试或跨平台执行。Issue #250 的 OpenClaw 流恢复和失败分类没有被此改动修复，保持 open。

凭据来源由宿主 init 注入，Gateway 不保证外部最新，也不重新读取文件或为每次 REST 调用宿主刷新。已发送请求的副作用不能被取消撤回；未知投递和上传不自动重放。
