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

## Review 后续验证（2026-10-30，基于 64e34af6）

本轮在原分支完成三项修复后统一提交：通知取消/过期抑制、明确 Bot/空间拒绝时撤销原投递代次、跨重连创建交互卡后的文字兜底。Jerry-Xin 的额外建议不在本轮修复范围。

- 修复前：64e34af6 编译产物复现 /stop、/reset 仍留下待发通知，以及 profile 查询期间 obsolete 未抑制 POST，共 3 个失败；通知修复后、身份/交互修复前的编译产物继续复现错误 Bot/拒绝空间没有撤销在途 scope、profile/POST 期间重连没有文字兜底，共 4 个失败。
- pnpm build、根 TypeScript no-emit、ESLint、命名、改动源码/测试格式及 git diff --check 通过。
- 既有 test/im-*、test/channel-*、test/gateway-*：596 通过，0 失败。只更新既有 interaction during-create 用例的返回值断言，仍检查终态编辑；没有增加默认测试数量。
- node --test test/recovery-dual-mode.test.js：CLI/SDK 2 通过，0 失败。该文件及 recovery fixture 本轮没有改动，未运行用户排除的 opt-in outage 分支。
- node --test .octospec/tasks/channel-rest-manager-credentials/regression.mjs：18 通过，0 失败。保留原 7 项凭据合同，增加 11 项手动专项：原轮通知 stop/reset；能力查询期间取消、过期与正常发出；明确拒绝后的在途取消、阻止后续旧请求及恢复原身份不复活；真实 Runtime + 宿主凭据回调的错误 Bot/拒绝空间；交互卡在 profile/POST 两阶段重连后，文字命令通过新连接送达、用户响应到达原 invocation、卡片仍能收尾且 invoke 不重复。
- 本轮合计 616 通过。HTTP/WS 边界使用 fixture，真实 Runtime/Transport/Connector/Dispatcher 参与相应验证，不代表线上服务或真实切网验收。
- 相对 main 的 .github、scripts、根 package.json diff 仍为空；检查列表没有扩展。未安装、重启、合并、访问真实 Provider/IM 或重跑全部仓库测试。
- 读取前一提交 64e34af6 的 CI 失败日志：macOS Node 26 的 test/codex-process-cleanup.test.js / canonical complete-eof 报 PROCESS_CLEANUP_TIMEOUT（run 40992032238）。该执行清理路径不在本 PR 改动范围，本轮未修改或宣称修复；新提交的托管 CI 需单独确认。
