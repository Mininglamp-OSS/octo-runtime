---
type: Validation
title: Issue 245 本地验证
description: OpenClaw 模型轮次、工具归属和卡片投影的手动及真实 Playboard 证据。
tags: [openclaw, testing, protocol]
---

# 环境与范围

- 基线 `origin/main@ba2a706380bf244bc428b3465c0487c5b58e6975`，分支 `fix/openclaw-model-steps-245`，独立 worktree。
- macOS arm64，Node 24.19.0，pnpm 11.19.0；本机 OpenClaw 2026.9.4 使用已有连接，7.1 与 10.8 使用临时安装和独立状态/配置/端口。10.8 按其 engine 使用临时 Node 24.22.1，不替换全局 Node。
- 生产代码只改 OpenClaw adapter 的 Gateway 归一化与固定版本准入表，不改 CanonicalEvent schema、公共 API、卡片模板或其他 Adapter。
- SQLite/transcript 仅用于问题分析，生产实现只消费 Gateway 事件；记录不含凭据或原始 reasoning。

## 可重复命令

在本 worktree 内执行：

```sh
pnpm typecheck
pnpm lint
pnpm lint:names
node --test test/manual/openclaw-model-steps.test.mjs
node --test test/openclaw-compatibility.test.js test/openclaw-message-segments.test.js test/openclaw-gateway-client.test.js test/openclaw-queue-bounds.test.js test/openclaw-approval.test.js test/openclaw-runtime-connection.test.js test/im-protocol.test.js
node .octospec/tasks/245-openclaw-model-steps/verify-playboard-live.mjs
node .octospec/tasks/245-openclaw-model-steps/verify-isolated-gateway-live.mjs /path/to/openclaw-7.1/openclaw.mjs --resume
/path/to/node-24.22.1 .octospec/tasks/245-openclaw-model-steps/verify-isolated-gateway-live.mjs /path/to/openclaw-10.8/openclaw.mjs --resume
uv run --no-project --with pyyaml python .octospec/scripts/lint.py
```

手动专项不在 `test/*.test.js` 默认 glob 内，没有修改 package scripts、GitHub workflow、job、matrix、trigger、required check 或 gate。

## 确定性验证

- 初版 6 项手动回放在基线全部失败，复现模型步骤仅一轮；实现后通过。
- 当前 96 项手动专项通过，走实际 Adapter → canonical 校验 → ImRunProjector → reasoningPhases，包括 length 续跑、并行工具、迟到工具结果、延迟持久通知、run 身份过滤、旧 Gateway 工具后换轮、单次尝试失败、argsDelta/command_output、正文快照修正、多正文片段去重、最终文本精确值与单次投递、显式空最终正文、7.1 reasoning 标记丢失、text-only toolUse 和持久 stop 后重复 flush。
- 其中 62 项覆盖 7.1 至 10.8 共 31 个正式标签的有/无 phase 事件形状；请求同时经过既有固定 schema 严格校验。新增 5 个标签各有续聊请求校验。这是合同/事件回放，不是 31 个真实 Gateway 的模型调用。
- MC 组合回放使用已核对的 `length → length → error → toolUse` 边界，正文、参数与 ID 为替代值；末尾完成帧为验证添加，不宣称原 MC 已成功完成，也不宣称是完整原始 WS 抓包。
- 既有 OpenClaw 六套回归 175 通过、1 项 GC 条件跳过；连同既有 IM 协议回归共 198 通过、1 跳过，保留取消、断线、版本、审批及最终投递选择合同。
- workspace 构建/类型检查、lint、命名检查已通过。第一次 lint 与构建清理 dist 同时执行引起类型解析失败，构建完成后顺序重跑通过。
- OctoSpec lint 使用临时 PyYAML 环境执行；基线已存在 Issue 137 的三份 Markdown 缺 YAML frontmatter，保留并报告，不修改其他任务文档。新增文档链接及格式单独核对。

## 最终正文合同

过程 assistant 文本使用现有 commentary；原生 thinking 仍是 analysis；工具增量/输出仍是 tool_call。IM projector 会聚合所有 final 通道消息，所以不能把每轮正文先发 final 再期望消费者选最后一条。Adapter 成功收尾仅发布一份已选定最终回答，精确文本不含过程标记、thinking 或工具输出。

7.1 已有可选的 [assistant phase](https://github.com/openclaw/openclaw/blob/2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4/src/shared/chat-message-content.ts)，但实际帧不保证含 phase。7.1 原生 payload 构造会丢失部分 reasoning 标记；对其已安装 formatter 的直接调用已复现。因此优先使用原生 `meta.finalAssistantVisibleText`，包括空值；否则排除 payload 的 reasoning/commentary/error，再对缺正文的 status-only 回执做当前步兼容回退。显式 commentary 永不提升为 final。此逻辑只影响 adapter，不改变 projector 或投递规则。

## 固定版本核验

按 npm 正式版本列表补齐 9.34、9.35、10.6、10.7、10.8；7.1 到当前最新 10.8 共 31 个正式标签均有固定准入，另外保留既有 6.11。未知版本、beta/fork 继续拒绝。

新增版本的上游 commit、六份源文件 SHA256、请求字段 AST 与 required 字段比较方法见 [固定合同证据](compatibility-evidence.json)。10.6/7/8 的六份源文件与 10.5 完全一致；9.34/35 的实际发送 request/resume 字段及 required 列表也相同，因此复用既有 schema 进行手动严格校验。未把新标签加入默认 fixtures，未增加默认测试项。

## 本机 Playboard

测试脚本原生启动临时 Kernel/worker，使用本机 OpenClaw 的新建 QA session。模型按顺序执行两次无害 `printf` 后回答随机标记；不发送 IM、不改全局 Provider 配置、不重启常驻服务。临时 scratch 在 finally 移除，QA 原生 session 保留为本地证据。同步只读 observer 只输出事件类型、身份、字段名与边界，不输出正文、参数、认证或私有 reasoning。

| 验证 | 模型步骤 | 工具 | 缺少 stepId 的工具事件 | 终态/最终标记 |
| --- | --- | --- | --- | --- |
| 基线 9.4 新会话 | 1 | 2 | 6 | completed / 标记存在 |
| 修复后 7.1 新会话 | 3 | 2 | 0 | completed / 精确最终标记，1 条 |
| 修复后 9.4 新会话 | 3 | 2 | 0 | completed / 精确最终标记，1 条 |
| 修复后 10.8 新会话 | 3 | 2 | 0 | completed / 精确最终标记，1 条 |
| 修复后 7.1 原会话续聊 | 3 | 2 | 0 | completed / 精确最终标记，1 条 |
| 修复后 10.8 原会话续聊 | 3 | 2 | 0 | completed / 精确最终标记，1 条 |

最终版本的脱敏中间 checkpoint 和每次结果见 [真实 Playboard 证据](live-evidence.json)。工具一归第 1 轮，工具二归第 2 轮，最后回答归第 3 轮；3 次 start 与 3 次 finish 配对，卡片投影中间依次出现第 1/2/3 轮，command_output 始终属于工具。续聊断言 Provider session key 不变。脚本只读检查 `https://im-test.deepminer.com.cn/` 返回 HTTP 200；这不是 IM 投递或实际客户端 UI 验收。

7.1 隔离验证首次因自定义模型缺少 maxTokens 在 Provider 请求前失败，仅给临时配置副本补上模型限额后完成真实模型/工具测试。实测又暴露 text-only toolUse 后工具误开一轮、持久 stop 后同文 flush 误开一轮，两项均先复现再补手动用例修正；最终严格断言为 3 轮，而非只断言至少 3 轮。隔离 Gateway、临时配置与工作区均在 finally 清理，本机常驻服务及配置不变。

真实 Provider 验证是 7.1、9.4、10.8；其他正式版本为固定源码合同与离线回放。7.1 原生完成广播无 runId，续聊时仍拒绝无身份消息，以已关联工具后下一次模型输出换轮；因此续聊无工具、thinking-only/length 的边界不能可靠识别，不以到达时间或文本变化猜测步骤。新建随机独占 session 能接受原生无 runId 完成通知，手动 length/MC 组合回放覆盖该路径。

## 审查与人工验收

按用户指定 code-review，对基线 SHA 的工作树 diff 及新增文件做 Standards / Spec 两轴审查。初审发现的正文覆盖/重复、status-only phase 污染与 7.1 最终 payload 标记丢失均已修正并补专项，固定白名单文档同步问题已修正；最终两轴结论见 [review](review.md)。

交付后需用户本地实际卡片验收：再执行“写一个 MC 风格的 HTML”，确认中途轮次推进、每轮工具归属及最终内容。原生 thinking 含 HTML 允许保留。审查完成时 worktree 尚未全局安装；后续按用户授权安装如下。未提交、推送或发 PR。

## 用户本地验收安装

2026-10-29 用户授权“这个分支 build install -g 我来试试”。执行 `pnpm pack:release` 后，将本 worktree 的 `dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 用 `npm install -g --offline --no-audit --no-fund` 安装到当前 Node 24.19.0 的全局目录。安装后的 OpenClaw `dist/index.js` 和 `dist/compatibility.js` 与分支构建产物 SHA256 分别一致；CLI 标识 `0.0.0 / commit:ba2a706380bf (dirty)`，构建时间 `2026-10-29T09:34:47.544Z`。

安装前状态无执行中/排队任务。停止 Channel Gateway、重启 Executor Kernel，再启动 Channel Gateway；最终两个服务 IPC ready、worker ready，6 个 bot 在线、错误数为 0。保留已有 Home、连接、权限与服务定义；原先已有的 `definition_content` drift 保持，未重新安装服务定义。真实 IM 客户端卡片由用户开始人工验收，尚未宣称验收通过。

用户随后执行 hello.md/world.html case 并确认最终正文符合预期。Kernel 记录 completed；卡片仍为同步进度，同时卡片编辑返回 HTTP 400。附件 remote-file-unavailable 是后续独立交付错误，不改变该执行终态；用户明确 HTTP 400 由其他 PR 修复，本分支不处理，不能将该 case 写为完整卡片 UI 验收通过。

按用户再次授权重新 pack/global install 并重启，CLI 构建时间为 2026-10-29T09:52:56.493Z；全局 OpenClaw 与 Channel Gateway dist/index.js 和本分支构建产物哈希一致。重启后 Kernel PID 44697、worker ready，Gateway PID 45024、6/6 Bot online、无启动错误或在途任务。本轮交付只做 Git rebase/验证/PR，不再替换全局运行版本。
