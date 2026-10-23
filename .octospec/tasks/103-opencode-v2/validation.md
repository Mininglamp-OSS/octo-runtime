---
type: Task
title: Issue 103 OpenCode 2 真实验收
description: OpenCode 2.1.3、DeepSeek、MCP、审批、失败及测试 IM 的脱敏验证记录。
tags: [adapter, testing, interaction, mcp]
timestamp: 2026-10-23T05:00:00Z
---

# 环境与基线

- Runtime 初始基线：origin/main@445d2bb24f6ffc27bb4414c835e6a0b365f9f25b；已按用户要求 rebase 到 cc49c8b4ce2d04fd2389585d00ffcf8806b4af72，分支 research/103-opencode-v2；最终实现由同 PR 的提交确定。
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

## PR Secret Scan 误报核验

PR #116 的 Gitleaks 8.30.1 首轮扫描报告 `ad4e357a1d53e07bd12b7d1ebbd0d10d79dfb46b:scripts/verify-opencode-v2.mjs:generic-api-key:203`。该行是错误认证场景写死的无效测试值，来源为本任务测试代码，不是从账号或认证文件读取的值；两传输以此实际执行均返回 failed。该做法已按下文用户明确的禁止入库约束撤回，不保留固定值。

CI 采用 depth=2 的 PR merge checkout，暂缺父历史，因此将整份文件归到浅边界 ad4e357。在保留原始历史的隔离仓库复现同一版本及范围后，实际引入指纹为 `81f316e88c324e374b613dc6a12437da130fa5ff:scripts/verify-opencode-v2.mjs:generic-api-key:203`。仅将该原始历史指纹加入 `.gitleaksignore`，同步命名检查要求的规范化 SHA256 快照。首次收尾曾将测试值简化为更短的固定值；用户进一步要求禁止提交凭据占位值后，改为运行期生成。未豁免文件、路径或规则，未修改原始提交历史。

本地工具下载归档 SHA256 为 b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5，与官方 8.30.1 darwin arm64 校验表一致。验收结果：

- 保留历史隔离 clone，范围 `445d2bb..ad4e357`：加入精确例外后 0 告警，退出 0；加入前只报上述原始指纹，退出 1。
- 新建隔离 canary 提交，在同文件原 203 行及邻近 204 行放入非功能性密钥样式；PR 范围扫描在两处均报 github-pat，退出 1。
- 完整历史扫描在新增 canary 前有 135 个既有告警，本次样例无告警；新增后为 137，指纹集合比较确认仅增加上述两处 canary，原 135 项未被隐藏。因此这次验证证明例外范围有效，不宣称整个历史扫描通过。
- 当前测试值简化后重新运行 16 个真实场景全部通过，最终 cleanup=complete；命名检查与 7 项命名回归通过。
- 独立 Standards 收尾复核确认指纹、原始提交、规范化哈希和无效值修改准确，无剩余问题。远端 PR review 同时提出的唯一 P2 为本项扫描失败，本次修复覆盖该意见；托管重验以 PR 最新检查为准。

## 凭据禁止入库约束纠正

用户明确禁止在仓库提交 API Key，并要求写入架构设计约束。此前无效值是本任务写入的固定测试样例，不是读取用户配置或测试账号得到的凭据；仍不应以其非真实或扫描通过作为保留硬编码的理由。

已将禁止提交凭据值（含固定测试占位值）的合同写入 [architecture](../../rules/architecture.md#凭据值严禁进入代码仓库)。验收脚本的错误认证值改为每轮在内存调用 randomUUID() 生成；MCP 模拟服务的 Authorization 值同样仅在运行期生成，服务端仍严格比较本轮收到的值。实际认证沿用宿主已有配置，脚本不新增实际凭据读取或持久化，不输出这些测试值。历史扫描例外只对应原始非秘密固定样例，不作为提交实际凭据的许可。

运行期随机值版本重新执行 16 个真实场景全部通过，shutdown.cleanup=complete。脚本 AST 检查确认 apiKey 与 Authorization 两个字段均无字面量值，Gitleaks 8.30.1 对当前脚本 stdin 扫描退出 0；格式与 diff 检查通过。OctoSpec lint 仍仅有前述 3 个基线 frontmatter 错误。

## Rebase 到最新 main

2026-10-23 按用户要求从 `6700e16` rebase 到最新 `origin/main@cc49c8b4ce2d04fd2389585d00ffcf8806b4af72`。知识目录新增条目冲突保留双方内容，main 的安全整改及本任务凭据禁止入库约束均保留。`git range-diff` 确认原四个提交的差异仅为目录上下文；逐文件比较确认 OpenCode、共享 ACP/SDK 入口、本任务回归及三个真实验收脚本与 rebase 前一致。本轮不重复未改变的真实模型/IM 测试，原证据仍按原始提交记录。

原实现提交 `81f316e` 对应 rebase 后 `12abf7ae87b5162731d7ee6631ce050ce929619e`。保留真实引入历史的 PR 范围扫描确认唯一告警仍是同一已核验的固定无效历史样例；精确例外仅同步该提交 SHA，命名检查规范化哈希同步为 91c998b5156daffb8479d70b4a5ab785f94eeb3e7fae2a18c2a24f81d9f2abd8。当前源代码仍只在运行期生成非功能性测试值，没有重新引入固定凭据值。

更新基线后的验证结果：

- `pnpm install --frozen-lockfile` 通过并完成全 workspace 构建，保留 main 的锁文件及 Vitest 4.1.12 升级；根 TypeScript noEmit 检查通过。
- Node 全量使用 concurrency=4：1731 项，1691 通过、40 跳过、0 失败；包括 main 新增的安全及发行进程回归。UI 35 项全部通过。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check` 通过；命名回归包含在 Node 全量内。
- Gitleaks 8.30.1 对 `cc49c8b..HEAD` 的 PR 范围扫描退出 0；`git diff --check` 通过。没有修改检测规则或扩大例外范围。
- 四个重放提交均保留原配置作者及唯一 Codex trailer；远端更新使用明确旧 head 的 force-with-lease，避免覆盖并发更新。

## 证据边界

未在 Windows/Linux 做真实 OpenCode E2E；未测其他 2.x、其他模型、ACP 图片/表单/终端扩展或实际 Electron App。ACP effort setter 尚未实现，CLI 不传 model 时不猜测默认模型来套用 effort。合成子进程回归覆盖版本超时、异常退出及 stop 后非零退出，不能代替相应 OS 上的原生集成证据。Core 对其他未经此 Adapter 收敛的异常仍可能保守报告 incomplete，不将其解释为所有 Provider 清理问题已解决。
