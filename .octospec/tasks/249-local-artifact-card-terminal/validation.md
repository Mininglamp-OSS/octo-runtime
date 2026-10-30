---
type: Task
title: Issue 249 本地附件卡片终态验证
description: 实际 Gateway 与服务端模板渲染器的本地受控回放、修复及验证边界。
tags: [channel, delivery, testing]
---

# 根因与修复

前文为 2026-10-29 的初次验证记录；2026-10-30 在最新 main 上继续实施后的结果见文末。

基线 `origin/main@8b239e47231deed4c135b9b5add816484d17bb7f`，分支 `fix/gateway-card-terminal`，独立 worktree `octo-runtime-gateway-card-terminal`。环境为 macOS arm64、Node v24.19.0。

projector 将 final 正文保留在对应 model_step.content。阶段缺少 commentary/reasoning 时，展示层以此生成摘要；原实现仅折叠空白、截断，保留了 Markdown 目标。服务端 reasoning 模板的 TextBlock 会解析 Markdown，最终 cardmsg.Validate 只接受绝对 HTTP(S) URL。本地链接或图片使整次编辑被拒绝，包括同一请求内的 completed 状态。finish 失败保留诊断，但不阻断独立 final；后续附件上传、文件卡和普通正文均不会再次编辑进度卡片。

因此，“模型已结束”“终态请求已发送”“服务端成功更新卡片”是三个不同事实。这里复现了前两个成立、第三个失败；忽略报错不能恢复卡片状态。SVG 上传拒绝发生在后续独立路径，既不是本缺陷的必要条件，也不应覆盖真实生成终态。

仅修改 Gateway 的 reasoning-frame.ts：复用已有 mdast 解析依赖，在展示副本上保留可读文字、链接 label 和图片 alt，转义剩余 Markdown 标记后施加字符/字节预算；空 alt 使用非空占位。摘要、工具说明、错误及过程诊断共用此边界。诊断编号保留单词内下划线，并在文字转换后预留完整错误码/诊断编号的预算。projector、原 final、附件解析、上传和执行终态均保持原输入与语义。

# 本地复现证据

只读使用相邻 octo-server checkout `5cf83f5725a6ce71f4944a9ce1a17038268375cf` 的生产 Registry.Render、内嵌 0.4.0/0.4.1 模板、JSON Schema 和 cardmsg.Validate。服务器工作树无改动。

最小矩阵使用真实 projector 和 buildReasoningFrame：普通文字、远端 HTTPS 链接被接受；本地 HTML 普通链接、本地 PNG 图片引用和本地 SVG 链接被拒绝，尽管 frame.state 均为 completed。典型返回：`cardtmpl: render failed post-build: cardmsg.Validate: cardmsg: url 只接受绝对 http/https`。

完整受控回放使用实际 ImRuntime、GatewayTransport、projector、CardSession、REST 请求序列、附件路径读取、上传实现和 final URL 替换。只替换 Kernel 事件源、网络边界及 WS ACK；每次卡片请求交给上述生产渲染器。以下为同一脚本对修复前 reasoning-frame 和修复后实现的结果：

| 场景 | 生成终态 | 最后成功卡片状态（修复前 → 后） | 文件上传 | 最终 HTML 云链接 |
| --- | --- | --- | --- | --- |
| HTML/PNG/SVG 全部成功 | completed | reasoning → completed | 三文件成功 | 保留 |
| SVG 凭据请求返回 415 | completed | reasoning → completed | HTML/PNG 成功，SVG 报 upload-rejected | 保留 |

修复前两例都记录到 state=completed 的卡片编辑被 URL 校验拒绝；上传仍成功，最后卡片仍是 reasoning。修复后同一进度卡片 message_id 的终态编辑先成功，再开始附件准备；不重跑模型，不残留 progressText，traceCollapsed=true。成功文件卡和 PNG 图片引用继续交付，SVG 失败明确进入 final。

历史追踪：final → step.content 的代码可追溯至 `4ba9b16e`（2026-10-14）；当前模块摘要 fallback 已在 `1541538` 中存在。已有 commentary/reasoning 会优先于 step.content，截断也可能移除完整引用，因此旧版本可以潜伏。不能仅据此认定 PR #248 引入本缺陷；服务端部署与原截图实际帧未核验。

# 检查结果

- 完整 workspace 构建通过；最后实现调整后重新构建 Gateway 包，并执行根 tsconfig 的 noEmit 类型检查通过。
- [显式手动专项](regression.mjs)：19 通过，0 失败/跳过。包含绝对、相对、file、Windows 路径，引用式链接、图片、嵌套、代码、转义、截断、诊断与空 alt；两个完整 Runtime 交付场景使用生产 Go 渲染器。
- 13 个现有相关测试文件：192 通过，0 失败/跳过。覆盖 im-protocol、im-artifact-delivery、im-runtime、im-extra-disposal、im-pre-execution-failure、im-final-mention、im-model-wait、gateway-runner-drain、gateway-shutdown-drain、im-task-retry、im-diagnostic-completion、im-delivery-status、im-delivery-ack。
- 首次相关测试发现诊断编号被多余转义，191 通过/1 失败；修复标识转义及终态诊断预算后，上述 192 项全部通过。
- pnpm lint、pnpm lint:names 通过；最后生产调整后再次检查变更文件 ESLint 通过。变更 TS/MJS 的 Prettier 和 git diff --check 通过。
- OctoSpec 全仓 lint 未通过：main 已有 Issue 137 的 brief.md、review.md 和对应 2026-10-29 journal 缺少 YAML frontmatter；已用 git show origin/main 核对，未修改这些无关文件。本次新增单元与本地链接未报告错误。
- 专项代码仅在 tasks 下显式手动执行，不加入默认测试目录或脚本；GitHub workflow、package.json、lockfile、默认测试入口与 CI Gate 无改动。

复跑命令（先确保 node/pnpm 在 PATH 中；不写入默认脚本）：

```sh
# 在 octo-server checkout 执行，源码路径换为本 worktree 的绝对路径
go build -o /tmp/octo-card-render-probe /absolute/worktree/.octospec/tasks/249-local-artifact-card-terminal/server-render-probe.go

# 回到 Runtime worktree；先 pnpm build，随后执行专项
OCTO_CARD_RENDER_PROBE=/tmp/octo-card-render-probe node --test .octospec/tasks/249-local-artifact-card-terminal/regression.mjs
```

# 实际边界

以上为合成事件与受控 HTTP/WS 回执的本地回放；调用了真实生产渲染器，但没有连接部署中的 IM 服务、真实 Provider 或桌面客户端。原截图没有对应请求日志，不能认定已证明其唯一现场原因，也不把本地成功视为线上已恢复。未做 Windows 原生验证、全仓测试或发布验收。不重启现有服务、不提交、不推送、不创建 PR、不部署；issue 保持 open。

根因已在 [Issue 249 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/249#issuecomment-6496780200)记录；修复前后的完整 Runtime 结果、终态 REST 顺序及检查限制见[后续评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/249#issuecomment-6497128607)。

# 2026-10-30：可观测性与降级终态

用户明确授权在原 worktree 继续修复；先 fast-forward 到 origin/main@ed7a4c89，保留此前三个已修改文件和全部专项资料。自动保存恢复时仅知识索引冲突，已保留双方任务条目；原改动备份仍在 autostash。未创建功能提交、PR 或部署。

## 实现

- CardSession 显式向 dispatcher 标明 send/edit。失败回执使用 IM_CARD_SEND_<HTTP status> / IM_CARD_EDIT_<HTTP status>，普通投递保留原码。每次 HTTP 失败通过原 Run 诊断链路带出 path、http_status、response_body，不记录请求正文。
- path 去除 query/fragment，响应正文复用 sanitizePublicValue 脱敏后最多保留 200 Unicode 码点。RuntimeLogging 仅在 channel-gateway 的 channel.diagnostic 卡片失败事件中放行两个固定 API path、有效 HTTP 状态和同样脱敏限长的响应摘要；其他 Extra/事件和组件状态镜像不放行这些字段。
- 保留本地链接转纯文字的正常修复路径。完整终态帧明确收到 400 后，沿同一 message_id、新 card_seq 只尝试一次精简终态帧；保留实际 completed/stopped/error、收起详情、移除 progressText，不重跑执行。首次创建明确拒收时使用相同 client_msg_no 降级创建。
- 精简帧确认投递成功才视为终态收尾成功，finish 正常完成并记录 IM_CARD_TERMINAL_DEGRADED，不触发 IM_PRESENTATION_FAILED。原 400 诊断仍保留。精简帧也被拒绝、其他 HTTP 失败、结果未知或取消不能伪报成功；重复 finish 保留未完成事实。

## 验证结果

macOS arm64，Node v24.22.2，源码 ed7a4c89 + 本地修改。

- pnpm build、根 tsconfig 的 noEmit 检查、pnpm lint、pnpm lint:names、变更代码格式和 git diff --check 均通过。
- 两份显式手动专项共 34 项通过，0 失败/跳过：原专项扩充为 21 项，新增 diagnostics.mjs 13 项。四个完整 Runtime/Transport/附件回放覆盖富终态帧被拒绝与 SVG 部分失败的组合，均先确认原进度卡片 completed，再完成最终附件投递，仅执行一次模型且没有 IM_PRESENTATION_FAILED。卡片请求使用生产 Go 模板渲染器验证；另有 loopback HTTP 的序号/同消息 ID、失败保持、取消、SEND/EDIT 分类及真实日志落盘脱敏限长验证。
- pnpm test:suites：WebUI 35 项通过；Node 2486 项中 2394 通过、91 跳过、1 失败、0 取消。唯一失败为 test/verification-command.test.js:162 的“未安装保留 ENOENT”：fixture PATH 包含 Node 所在目录，而该目录实际已有 octo-cli。未改主线 checkout 单独执行同一用例也得到相同失败；scripts/verification-command.mjs 及其测试与 origin/main 无 diff。未修改此无关用例或删除本机 CLI。
- OctoSpec 检查经 uv 临时提供 PyYAML 后执行，报告四项主线既有 frontmatter 缺失：Issue 137 的 brief/review/journal 和 Issue 246 validation。本任务资料未被报告。系统 python3 缺少 PyYAML，未修改全局 Python 环境。
- 相对 origin/main，.github、scripts、package.json、pnpm-lock.yaml、默认 test 目录均无 diff；没有新增 workflow/job/矩阵/触发/必需检查/Gate 或默认测试开关。

专项复跑（显式手动，需先构建）：

```sh
OCTO_CARD_RENDER_PROBE=/tmp/octo-card-render-probe node --test \
  .octospec/tasks/249-local-artifact-card-terminal/diagnostics.mjs \
  .octospec/tasks/249-local-artifact-card-terminal/regression.mjs
```

本轮只完成本地实现与受控验证。未请求部署中的 IM 服务、未新发真实 Provider turn、未验桌面客户端渲染、未重启运行服务，也未提交/推送/创建 PR/合并/发布安装。服务端回执确认更新不等于端上渲染验收；服务端若连精简帧也拒绝，仍会保留明确失败。

# 2026-10-30：审查与 PR 交付

以上保留各阶段的授权和结果记录。用户 18:03 最新授权为：完成本地修复、code review、同步最新 main、提交并创建 PR；合并、部署、安装与服务重启不在本轮范围。

- 再次 git fetch origin main，并执行 git merge --ff-only origin/main：Already up to date，最新主线仍为 ed7a4c89。
- 独立 Standards 与 Spec 审查已完成。Standards 确认一项 P1 凭据泄露：响应 JSON 被当作原始字符串，敏感字段过滤无效。修复为共享 sanitizeDiagnosticBody，先结构化脱敏，再对原始或内嵌文本保守裁掉敏感字段后缀，最后限长；不确定的 Unicode 转义文本不公开正文。dispatcher 与日志边界分别过滤。敏感字段后的其他错误详情可能随之省略。
- 最终 Standards 独立复审的 30 个探针通过，Spec 无确定阻断项，详见 [review](review.md)。
- 完整 pnpm build 通过；最终摘要函数调整后重建 SDK 并重新执行根 tsconfig noEmit、ESLint 和专项。显式手动专项最终 35 项全部通过，0 失败/跳过。其中凭据回归内部覆盖五类敏感键乘五类正文形态，验证诊断回调与直接日志落盘。
- pnpm test:suites 再跑结果与上一轮一致：WebUI 35 通过；Node 2394 通过、91 跳过、1 失败。唯一失败仍为已在未改 main checkout 复现的 verification-command ENOENT 环境隔离用例。最终新增的内嵌 JSON 脱敏边界又通过完整手动专项复跑。
- pnpm lint:names 通过；OctoSpec 复跑仍仅报告上述四项既有 frontmatter 缺失。相对 main 的 .github、scripts、package.json、pnpm-lock.yaml 和默认 test 目录 diff 为空。未扩大任何 CI 范围。

PR 通过 Closes #249 关联原 issue。线上 IM、真实 Provider 和客户端仍未新验；未合并或部署。
