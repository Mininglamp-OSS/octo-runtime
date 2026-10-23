---
type: Task
title: Issue 103 OpenCode 2 真实验收
description: OpenCode 2.1.3、DeepSeek、MCP、审批、失败及测试 IM 的脱敏验证记录。
tags: [adapter, testing, interaction, mcp]
timestamp: 2026-10-23T05:00:00Z
---

# 环境与基线

- Runtime 基线：origin/main@445d2bb24f6ffc27bb4414c835e6a0b365f9f25b，分支 research/103-opencode-v2；最终实现由同 PR 的提交确定。
- macOS 26.6.2 / darwin arm64，Node 24.19.0，pnpm 11.19.0。
- 用户安装的 `/Users/lvsijia/.opencode/bin/opencode`：`opencode v2.1.3`。验收时 npm `@opencode/cli` latest 亦为 2.1.3。
- 用户已有模型配置：provider deepseek，model deepseek/deepseek-flash。认证由宿主已有配置提供；不修改、不输出认证文件。
- 测试 IM：im-test.deepminer.com.cn；orbtex-opencode 接收，orbtex-codex 发送。原始账号文件只通过环境指定，不复制到仓库。
- 最低版本选择 **2.1.3**，也是验收时最新稳定 2.x。未宣称 2.0.0 支持。

## 兼容矩阵

| 实际版本 | probe | full_access | ask | 结论 |
| --- | --- | --- | --- | --- |
| 2.1.3，最低支持/当前最新 | available | CLI 真模型、工具、续聊、MCP、取消、错误通过 | ACP 初始化、配置、真模型、工具、续聊、审批、MCP、取消、错误通过 | 通过 |
| 1.18.30，独立真实 arm64 二进制 | 明确拒绝 | 不先 probe 直接 invoke 仍拒绝 | 不先 probe 直接 invoke 仍拒绝 | OPENCODE_VERSION_UNSUPPORTED，含检测版本及 V1 不再支持 |
| 2.0.0 / 2.1.2 / 预发布 / 3.x | fixture 拒绝 | fixture 拒绝 | fixture 拒绝 | 版本门禁回归，不是这些版本的真实集成证据 |

V1 使用 npm pack 解包至临时目录，没有全局安装。实际样本 opencode-darwin-arm64@1.18.30，完整性 sha512-KO4FJGZpgmSz+NNQ6PizynT5qAzVfoZI5HJLpyD0tYNqePPu87g2/UgVmNW663Bock2r75koLZFjR5waZiFiqw==。旧 nvm 全局 opencode-ai@1.18.30 已按用户要求卸载，V2 安装保持原样。

## 真模型场景

`scripts/verify-opencode-v2.mjs` 通过公开 AgentExecutor.invoke 执行，未直连模型代替 Runtime；每个场景断言恰好一个终态。

| 场景 | CLI full_access | ACP ask |
| --- | --- | --- |
| shell 写文件、读工具、本轮环境值与真实 workdir | completed，2 个工具 | completed，2 个工具及 2 次审批往返 |
| 同一 providerSession 续聊，重复首轮记忆标记 | completed，同 sessionId | completed，同 sessionId，无历史答案重放 |
| 活动模型/工具期间取消 | cancelled | cancelled |
| HTTP MCP 发现并调用 octo_echo | completed | completed，真实审批往返 |
| MCP 合成 Authorization header | 服务端收到正确工具调用与 header | 服务端收到正确工具调用与 header |
| 显式 model + effort=high | completed，V2 model#high | 未实现 setter，按既定合同提示未应用 |
| 拒绝写文件审批 | 不适用 | cancelled，目标文件不存在 |
| 无效 JSON 配置 | failed，未启动执行传输 | failed，未启动执行传输 |
| 实际错误 provider apiKey（V2 settings.apiKey） | failed | failed |
| 不存在的 provider/model | failed | failed |

上述 16 个 Run 最终 shutdown.cleanup=complete。正常、失败及取消后进程检查仅保留用户原有共享 `opencode serve --service`，没有本轮 run/acp/private serve/sleep 遗留。未停止或接管用户原有共享服务。CLI 工具帧可能只有终结态；usage 在原生实际提供时保留，不伪造缺失 token 数。

## 真实 IM 往返

`scripts/verify-opencode-im-live.mjs` 在双方已加入的测试群运行：测试消息显式 mention 接收 Bot，Gateway 限定测试 sender 和群，Kernel 服务由当前宿主原生构造，内部独立 worker 调用同一 OpenCode Adapter。

结果：真实 WebSocket 入站 -> Gateway -> KernelClient.invoke -> worker -> AgentExecutor -> OpenCode 2.1.3 -> DeepSeek -> Gateway 投递。恰好 1 个 Run，run.completed；按消息发送者及随机标记确认服务端群历史中实际收到 Bot 回复。Gateway、Kernel 和临时目录均关闭。

测试 Bot 之间直聊返回平台 not_friend；因此采用共同测试群验证，没有把好友限制当作 Adapter 错误。

## 可复现命令

```bash
pnpm build
OCTO_OPENCODE_COMMAND=/absolute/path/to/opencode node scripts/verify-opencode-v2.mjs
node scripts/verify-opencode-v1-rejection.mjs
OCTO_OPENCODE_COMMAND=/absolute/path/to/opencode \
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/test-accounts.md \
OCTO_CHANNEL_QA_GROUP=<test-group-id> \
node scripts/verify-opencode-im-live.mjs
node --test test/opencode-v2.test.js test/adapters.test.js test/context-mcp.test.js
```

## 回归与工程检查

- 最终 Node 全量使用 `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js`：1714 项，1674 通过、40 跳过、0 失败。UI 35 项通过。
- OpenCode、ACP 清理、流量限制、MCP 和 effort 相关回归：84 项全部通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm docs:check`、`pnpm format:check` 及 `git diff --check` 通过。
- 首轮默认高并发全量为 1713 项，1671 通过、40 跳过、2 项 Kernel 恢复计时超时；两个失败文件独立复测 6 项全部通过。随后新增 ACP 清理异常回归，再运行上述低并发全量通过，不将首轮失败隐去。
- OctoSpec lint 仅报告 3 个基线已有文件缺少 frontmatter：systemd-directive-paths 的 brief.md、review.md 及对应 2026-10-22 journal；本任务无新增错误。
- 固定实现提交 `81f316e` 的双轴审查通过，Standards 与 Spec 均无需要修复的问题，见 [review](review.md)。

## 证据边界

未在 Windows/Linux 做真实 OpenCode E2E；未测其他 2.x、其他模型、ACP 图片/表单/终端扩展或实际 Electron App。ACP effort setter 尚未实现，CLI 不传 model 时不猜测默认模型来套用 effort。合成子进程回归覆盖版本超时、异常退出及 stop 后非零退出，不能代替相应 OS 上的原生集成证据。Core 对其他未经此 Adapter 收敛的异常仍可能保守报告 incomplete，不将其解释为所有 Provider 清理问题已解决。
