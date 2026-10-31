---
type: Verification
title: Issue 255 已受理任务与 REST 投递验证结果
description: 记录本地对照及真实 IM 连续断线验证，断线期间新消息按用户决定不纳入范围。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T00:00:00Z
---

# 验收脚本修正（2026-10-31）

PR #262@6ab97c16 的后续评审确认两个手动验收入口仍引用已删除的 WS 发送 API。本次只改脚本与任务记录，不修改 packages 下的运行时实现、CI 或默认测试选择。

- `scripts/verify-im-context-live.mjs` 删除旧 `--delivery` 和 `--delivery-disconnect` 的迟到 ACK/未知通知验收及相关 import。旧参数在账号/网络访问前明确拒绝并指向现有 #255 REST 实网验收，避免静默落入默认模式。Context、交互、容量、日志、生命周期等其余检查保留；交互 Connector 构造不再传旧发送回调。
- 启动 smoke 继续暴露同文件原有 AgentExecutor 旧 Kernel 导出引用，已改为当前 Core 导出。没有恢复兼容导出或修改 Core。
- `scripts/verify-gateway-drain-live.mjs` 的 preload 改用 `delivery/send-error.js`，将明确拒收注入移到 `OctoConnector.message`；卡片观察/故障分支和一次永久拒绝断言保留。CLI 和 SDK 继续共用生成的模块，没有新增运行时开关。

验证环境 Darwin arm64 / Node 24.22.2，基线 6ab97c16 加本次未提交脚本变更：

- 无账号启动两个入口均到达预期账号检查；两个已删除参数均在实网前明确拒绝，无模块缺失错误。共四种入口检查通过。
- 通过 TypeScript AST 定位脚本实际的 preload 生成块，生成并执行三种模块：REST 明确拒收、正常卡片观察、终态卡片拒收。真实 dispatcher 证明永久拒收只发一次，正常卡片调用原方法并写出观察记录。使用本地 fixture 和独占临时目录，结束恢复 prototype 并删除目录；不是实网或真实 Provider 验收。
- 显式 #255 回归 21/21 通过；两个“第 4 次成功”的卡片序列 `503/503/503/200` 与 `400/503/503/200` 已在同一核心源码上实际执行，均恰好四次并成功。
- `pnpm lint`、两个脚本的 `node --check`、修改脚本/配置的 Prettier 及 `git diff --check` 均通过。packages、.github、依赖与默认检查入口没有差异。仅脚本修改，不重复无关全量构建或调用模型。真实 IM、Provider、Wi-Fi 及完整实网 drain 本轮 not run，不把 smoke 当作 live acceptance。

两个 P1 的核对：默认 Extra 凭据入口仅读取配置 `bf_token`，同一配置的 WS 重连不产生新 token；凭据源抛错不会执行赋值，验证/握手网络失败不会清除该值。自定义来源另行返回空/畸形值是凭据输入变化，按明确失败处理，不据此增加“last verified token”或等待 WS 验证。重试意见误将回调定义当作执行：`attempts: budget.remaining` 在调用 dispatcher 前已求值为四，实际调用回调时才扣减；第四次成功实测与代码一致。说明这些意见不构成所述 P1，同时单独承认并修正遗留脚本问题。

# 提交前审查

本轮按用户授权 review、修复并提交。审查范围为 HEAD@332413ae4bafb3ad5afec952bad761298f78f3ff 的完整工作树差异及新增文件；对照昨天 PR #251 的 ed7a4c899e5666238bc67e6a8418e3805ac924da，单独区分中间主线 #256。环境为 Darwin arm64、Node 24.22.2，审查时工作树有未提交改动。

审查先核对 WS/任务/投递各自所有权，再沿输入准备、FIFO、取消、身份撤销、REST 回执、卡片收尾和 CLI 日志检查调用链。逐文件检查生产实现、测试夹具与删除的旧合同；不把删除的行为要求为兼容分支。新增专项和实网脚本全文检查，未跳过变更文件；生成 dist 不纳入 Git 差异。

发现并复现两项 medium 问题，提交前均已修复：

- `transport/card-session.ts` 的终态精简帧会重开 dispatcher 预算：400→503 连续失败实发 5 次，503/503/503/400 后精简帧连续失败实发 8 次，超过同一 finish 总共 4 次的合同。改为原帧和精简帧共用当前 finish 的剩余预算；保留主线 #256 的精简展示能力。两条失败注入在修复前失败、修复后均只发 4 次。
- `octo-runtime-adapter-sdk/src/service-status.ts` 过滤掉 `IM_CREDENTIALS_REQUIRED` 与 `IM_BOT_TOKEN_INVALID`，使最终投递的这两种错误无法由 CLI 查询。真实 RuntimeLogging 写盘并通过 CLI 读取复现为空，修复后保留两个错误码与 run_id；同步修正 SDK 指南中“不含 run 标识”的过时说明。

复现与复验命令为 `node --test --test-name-pattern='shares four|credential delivery' .octospec/tasks/255-rest-task-delivery/regression.mjs`。修复前 3 项失败，修复后 3/3 通过；该日志用例验证真实日志链，凭据错误的产生路径由调用链审查确认。其余普通进度、正常终态、取消与身份调用方由相关组合回归覆盖。没有尚未解决的 medium 或更高问题。

## 简化的可核对依据

生产代码仅统计两个受影响包的 src，不计测试、任务文档或生成产物，含新增 9 行 send-error.ts；以暂存后的 git numstat 精确核算：本次相对 rebase 基线增加 187 行、删除 536 行，净减 **349 行**；直接相对昨天净减 **184 行**，差额为主线 #256 的既有改动，不能混记成本次增量。

| 位置或行为 | 昨天基线 | 当前 |
| --- | --- | --- |
| WuKong 实现行数 | 576 | 406；删除 6 个出站状态字段及发送方法 |
| GatewayTransport 实现行数 | 811 | 750；删除当前 WS 选择、跨连接接管与 15 秒轮询等待 |
| ImRuntime 实现行数 | 1714 | 1689；删除未知投递通知编排 |
| 业务发送路径 | 文本/文件 WS，卡片 REST | 全部 REST；WS 只处理接收协议与恢复 |
| 出站等待状态 | 76 秒发送重试、30 秒迟到 ACK、恢复前最多 15 秒等待 | 对应状态与计时器全部删除；当前 final/finish 最多 4 次 HTTP 尝试 |

保留的 WS 注册、握手和快速重连/退避不是本次删除目标；10 秒心跳仅调整检测周期。新增 REST 同次在途 Promise 合并、成功回执和收尾预算仍有必要，用于同一输出防重与限定失败次数，没有持久化或后台补投。

修复后类型/构建、lint、命名检查通过。相关及显式手动组合 702 项：698 通过、0 失败、4 项缺少可选 Go 渲染探针而跳过。独占临时目录中的同版本 Node 运行全量 `pnpm test:suites`：WebUI 35/35，Node 2480 项中 2389 通过、91 跳过、0 失败；临时 Node 已清理，隔离原因同下文原有命令未安装夹具说明。日志为 `/tmp/octo-255-review-{typecheck,lint,names,tests,full-test}.log`。本轮不重复实网或实际 Wi-Fi 切换。

最终 `pnpm docs:check`（含 4 项示例测试）、受影响源码/专项格式检查、实网脚本语法检查及 `git diff --check` 通过。相对 origin/main 的 `.github/`、package.json、pnpm-lock.yaml、scripts/ 差异为空，既有 CI 的 workflow/job/检查选择没有扩展。审查结论与简化对照随本地提交保留，不推送或部署。

# 结论

本项按“HTTP 正常，只有 WS 恢复慢或不能恢复”的需求前提实施。已受理任务的队列、准备、卡片及最终文本/文件不再等待 WS；来回重连不重新 invoke。真实 im-test 群的三轮受控断线验证通过。

用户随后明确：断线期间未收到的新消息不在本需求范围，不增加额外接入。此前额外探测的一条断线消息未观察到重连补投，仅保留为历史测试事实，不作为本项缺口或后续实施目标。当前实网脚本已移除该探测；本项没有新增任务事件轮询、第二接收通道、持久队列或宿主/SDK 配置。禁止范围已写入[架构规则](../../rules/architecture.md#channelgateway-任务接收与投递边界)。

范围收紧时重新运行显式专项 11/11 通过，实网脚本语法检查及 `git diff --check` 通过；本轮未再执行实网脚本。随后按用户进一步明确的收尾重试与日志策略补齐实现，见下节。未增加接收机制，CI 及默认测试入口无改动。

## 当前收尾策略与日志验证

### 最新职责清理结果

心跳验证后，用户进一步明确直接删除旧 WS 业务发送与投递检测/接管，不考虑旧 API 兼容性。此前“WukongConnection 是公开导出，尚未删除发送链”的阶段记录至此被本次授权与实现取代，保留旧记录仅供追溯。

已删除 WukongConnection 的 sendText/sendFile/isDelivered、构造参数 onDelivered、业务 SEND/SENDACK 关联、活动发送/重试状态、30 秒迟到 ACK 窗口及 76 秒发送状态机。接收 ACK、加密入站、规则通知、10 秒 PING/10 秒 PONG 和串行重连保留。未知通知的接口、卡片工厂和自动分支全部移除，REST 不再接收或调用 current transport 查询；REST 错误类型独立为 delivery/send-error.ts，没有兼容包装或备用 WS 发送路径。

Bot/任务取消与身份撤销由原所有者继续执行，有界 REST 成功回执仅用于相同 effect 防重。相关测试把取消/身份场景转为实际 REST 失败卡或文本，保留入站接收 ACK 及心跳验证；仅删除六项专属于已移除 WS 发送/未知通知的测试，没有新增默认测试或扩大 CI。

最终本地结果：

- `pnpm typecheck`（含 workspace build）、`pnpm lint`、`pnpm lint:names`、`pnpm docs:check`、修改文件 Prettier 和 `git diff --check` 通过。
- 相关及显式手动组合共 699 项：695 通过、0 失败、4 项缺少可选 Go 渲染探针而跳过。覆盖当前 final/finish 有限重试及真实 CLI 日志、WS 一直离线、队列/环境/图片准备、身份撤销及重复切换、REST 历史和附件路径。
- 使用独占临时目录中的同版本 Node 24.22.2 运行 `pnpm test:suites`，避免前述已有全局 octo-cli 与“命令未安装”夹具冲突；WebUI 35 项全过，Node 2480 项中 2389 通过、91 跳过、0 失败。结束后删除本次复制的 Node 和独占目录，未改用户安装。
- 静态核对 WuKong 出站仅有 CONNECT、接收 ACK、PING/PONG；已无业务 SEND、发送重试或迟到确认状态。相对 origin/main 的 `.github/`、package.json、pnpm-lock.yaml、scripts/ diff 为空。

日志为 `/tmp/octo-255-cleanup-{typecheck,lint,names,docs,tests,full-test}.log`。清理后未再次运行实网或实际 Wi-Fi 切换；前述 CLI/SDK 真计时长测属于心跳调整阶段的证据，不改记为清理后实测。没有提交、推送、安装、重启现有服务或部署。

按用户授权发布并回读 [#255 英文评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/255#issuecomment-6525331345)，说明此前职责混用、当前 WS 入站与 REST 出站分工、直接删除旧 API、失败预算和验证边界；不是发布或部署公告。中文设计对照见[原有耦合与本次删除](design.md#原有耦合与本次删除)。

用户最终明确：已受理 AgentRun 与队列不依赖 WS 恢复；仅当前 finalMsg 和卡片 finish 对暂态 REST 失败首发后最多重试三次（共最多四次尝试），成功即停止。普通过程卡片每个快照一次，失败结束该次发送。取消、过期、身份撤销或明确不可重试拒绝提前结束。收尾耗尽后记日志，不再追加未知通知、重跑 AgentRun、等待 WS 补投或强制持久化待发内容。这一策略取代初版“文本首次未知不再尝试”的设计，错误仍不虚报送达。

实现沿用现有 dispatcher，只有 finalMsg 和终态 CardSession 显式使用新预算，helper 的 429 自动重试关闭，不叠乘 HTTP 次数。相同消息身份及原卡 ID/序号保持；产物准备缓存复用，文本重试不重新上传。既有 400 精简帧降级保留其明确拒收合同。

检查发现现有 `channel-gateway logs` 仅读取服务状态镜像，普通投递诊断虽然写入详细日志，却被镜像过滤。现已定向允许 Gateway 的 IM_DELIVERY_*、IM_CARD_*、IM_HTTP_* 诊断及安全 run_id 进入该视图；没有放开其他执行诊断、正文或凭据。final 失败日志补入原 run_id，卡片保持既有原运行关联。

当前专项扩展为 18 项，包含网络异常、503、缺回执、第三次成功、403 拒绝、普通卡片单次失败、finish 四次预算及重复 finish 不重开预算。新用例通过真实 RuntimeLogging worker 写临时日志，再执行实际 `node apps/cli/dist/index.js --home <temporary-home> channel-gateway logs --json`，验证能读到 warn 错误码和 run_id。final 用例在真实 GatewayTransport 的 WS 被关闭且注册持续 503 时运行，AgentRun 仍仅一次，原 completed 保持，无额外兜底卡片；HTTP 使用可控 fixture。

当前组合命令加入 `test/extra-status-logs.test.js` 与 `test/runtime-logging.test.js`，共 705 项：701 通过、0 失败、4 项缺少服务端 Go 渲染探针而跳过。构建/类型检查、lint 与 lint:names 通过。原有测试仅调整被替代策略的断言，新增专项保持显式手动运行；无 workflow、默认入口或依赖清单修改。本轮未重新执行真实 IM 或系统 Wi-Fi 切换，不能将原实网耗时当作新重试策略的实网数据。

随后执行全量 `pnpm test`，首次发现两个双模式恢复用例的共用 fixture 只把 WS SEND 计为回复；已按新的 REST 合同分类 sendMessage payload，原测试场景、恢复断言及用例数保持。两个 CLI/SDK 恢复用例单独重跑通过。另一个原有 `test/verification-command.test.js` 的“命令未安装”场景会把 process.execPath 所在目录纳入 PATH，因本机该目录已有全局 octo-cli 而失败；测试来源为原主线 #221，本次未改其源码或任何用户安装。

为验证真实全量结果，在独占临时目录复制同一 Node 24.22.2 可执行文件，让该测试的 Node 同目录不再含全局工具；PATH 仍保留原有工具来源，没有修改已安装文件。以该 Node 运行 `pnpm test:suites`，WebUI 的 35 项测试通过，Node 全量 2486 项中 2395 通过、0 失败、91 跳过。临时 Node 在验证结束后清理。日志为 `/tmp/octo-255-terminal-{full-test,isolated-full-test,recovery}.log`。初次全量失败与最终隔离全量结果分别保留，不将专项结果充当全量通过。

## 收益与恢复顺序

### 后续心跳调整

2026-10-30 用户确认将心跳从每 5 秒 PING / 一个 5 秒 PONG 周期调整为每 10 秒 PING / 一个 10 秒 PONG 周期。保留单个在途探测及仅 PONG 确认双向连接的行为；不恢复旧版 25 秒检查、超过 90 秒无数据才判失效的策略。正常调度下静默失联约 10–20 秒发现，仅用于接收连接恢复，已受理队列、AgentRun 及 REST 投递不等待它。当前规则、SDK 指南、就近注释及既有测试同步。

本轮 `pnpm typecheck`（含 workspace build）、`pnpm lint`、`pnpm lint:names`、修改文件 Prettier 及 `git diff --check` 通过。最初并行运行 lint 与 typecheck 时，build 的 clean 阶段移除了 lint 需要的生成类型；构建结束后顺序重跑 lint 通过，没有以修改无关源码消除该工具执行竞争。

显式运行 `node --test test/im-connection-state-machine.test.js test/im-delivery-ack.test.js .octospec/tasks/255-rest-task-delivery/regression.mjs`：121 项全部通过。覆盖 10 秒首次探测、再等 10 秒才断开、及时 PONG 保活、其他入站帧不能代替 PONG，以及原有 WS 长期离线时 REST final/卡片独立投递与有限重试。

显式 `OCTO_RECOVERY_OUTAGE=1` 的既有 CLI/SDK 长测初次运行暴露两处旧断言：停机恢复仍预期没有立即/快速重试的 5/10/15 秒策略，以及静默丢包解除后只给 8 秒上线时间。测试已按当前合同同步，容纳十次快速重试、现有 15 秒握手超时及下一次重试；未修改生产重连策略。SDK 长测通过，随后针对 CLI 重跑通过。SDK 静默失联发现 19950 ms、解除丢包后恢复 59 ms；CLI 发现 19956 ms、恢复 16068 ms，后者因立即重连的 CONNECT 在解除丢包前已被夹具丢弃，须等待既有握手超时。心跳检测与握手恢复分开计时，不把 10–20 秒写成整体上线 SLA。

日志位于本机 `/tmp/octo-255-heartbeat-{typecheck,lint,tests,recovery,cli-recovery}.log`。长测只使用本地 HTTP/加密 WS fixture 和真实产品定时器，不改系统网络或外部服务；不是 Wi-Fi A→B→A 实机验收。本轮未重复执行全量或真实 im-test。相对 origin/main 的 `.github/`、package.json、pnpm-lock.yaml、scripts/ diff 为空，未扩大 CI。

再次核对旧发送链：Gateway 生产路径已无 `WukongConnection.sendText/sendFile` 调用，但 `WukongConnection` 仍由包入口公开导出；其低层发送重试、迟到 ACK 等不能直接视作可删的私有死代码，删除需明确公开 API 兼容策略。本轮仅调整心跳及相关合同，不将其列为已完成清理。

1. A 网络已收到 T1/T2/T3：T1 运行，T2/T3 留在原 FIFO。
2. 切 B：Runtime 关闭旧 WS，并沿既有重连机制建新 WS；Bot/任务继续持有原身份、收件地址及队列。
3. B 的 HTTP 正常：T1 直接 REST 收尾，T2/T3 接续，Context/图片下载也不使用旧 WS 取消期限。
4. 切回 A、再切 B：重复连接替换；不重复 invoke、不重新上传已准备产物、不重建已有进度卡。新 WS 在线后接收后续任务和控制。
5. WS 自身的断线检测、握手耗时没有因本项缩短；结果和队列已不需要等待它。恢复后沿原 WS 接收后续任务，断线期间新消息不补收。

因此价值是消除“HTTP 可用却被 WS 阻塞”的结果延迟和排队准备失败。没有新增发送通道选择、恢复前探测、配置开关或宿主 token 刷新。

## 本地对照

原 main 的 dist 运行同一专项中两条关键场景：旧 WS 关闭后 executionEnvironment 报 IM_CONNECTION_REPLACED；final 在 3 秒内未完成而触发测试超时。修复版相同场景通过。

最终本地验证：

- `pnpm typecheck` 通过，包含 workspace build。
- `pnpm lint`、`pnpm lint:names` 通过。
- `node --test test/im-*.test.js test/gateway-*.test.js test/channel-*.test.js .octospec/tasks/255-rest-task-delivery/regression.mjs .octospec/tasks/channel-rest-manager-credentials/regression.mjs test/manual/channel-conservative-history.mjs`：650/650 通过，其中现有相关回归 596，新增显式专项 11，既有手动专项 43。
- 新专项覆盖原 WS 关闭前后准备、连续三轮替换、并发相同 effect、有效/缺失/畸形回执、5xx/网络未知不重写、403 拒绝、图片下载进行中断开、REST 历史位置及真实 Runtime 一运行四排队/重复入站去重。
- 相关现有回归覆盖 mention、文件准备缓存、同身份换 token、身份撤销/切回、stop/reset、队列容量及历史代次保护。
- 格式检查与 `git diff --check` 通过。相对 origin/main 的 `.github/`、package.json 和测试选择脚本 diff 为空；现有回归用例数不增加，新增专项不接入默认 CI。

命令执行日志位于本机 `/tmp/octo-255-*`，不是长期保存的工件。

## 最新 main 变基验证

用户随后要求从 octo-runtime 最新代码 rebase。已 fetch 并变基到 origin/main@332413ae4bafb3ad5afec952bad761298f78f3ff（#256）；保留全部未提交改动，没有合并冲突。同步适配新主线 Issue 249 专项的 Connector 构造与 REST 出站夹具，卡片终态、降级及诊断断言保持。

变基后 `pnpm typecheck`（含 workspace build）、`pnpm lint` 和 `git diff --check` 通过。上述 650 项连同 `.octospec/tasks/249-local-artifact-card-terminal/{regression,diagnostics}.mjs` 共 685 项：681 通过、0 失败、4 跳过。4 项需要额外的服务端 Go 渲染探针，本次未构建该探针，不记为通过；其纯 JS 卡片及诊断用例已执行。`.github/`、package.json、pnpm-lock.yaml、scripts/ 相对新 origin/main 无修改。变基没有创建业务提交或推送。

下方三轮真实 IM 的耗时证据取得于变基前初始基线；变基后执行的是上述本地组合验证，没有将旧实网记录改记为新基线实网验收。

## 真实 IM 验证

入口：[verify-im-live.mjs](verify-im-live.mjs)。仅 im-test，使用测试账号文件的两个 User Bot 和双方已加入的隔离 QA 群；发送前核对成员及唯一真人为 Bot owner。未改好友、成员、系统网络、部署或安装。最初私聊尝试因 not_friend 被拒绝，没有将其记录为收发成功；随后复用既有 QA 群。

真实 API、真实加密 WS 和附件上传；Kernel 是确定性 fixture，不调用模型。通过原断线回调关闭真实旧 WS，显式暂停新 GatewayTransport.start，直到队列排空、REST 结果回读完成才放行重连。三轮均先准入三条任务，一运行两排队。

| 轮次 | WS 离线期间 final 回执距断线时间 | 放行重连到 online | 历史回读 | 原进度卡离线收尾 |
| --- | --- | --- | --- | --- |
| 1 | 328 / 849 / 1657 ms | 563 ms | 三条全部存在 | 同消息 ID 终态编辑成功 |
| 2 | 226 / 717 / 1138 ms | 510 ms | 三条全部存在 | 同消息 ID 终态编辑成功 |
| 3 | 228 / 939 / 1327 ms | 620 ms | 三条全部存在 | 同消息 ID 终态编辑成功 |

9 个已受理任务均只 invoke 一次；9 张进度卡没有重建，9 个终态在离线期间写入，序号单调递增；另有 1 张原生文件卡在 WS 离线时发送。无诊断错误，正常关闭。上述耗时包含确定性执行、队列串行、卡片/成员准备及首轮文件上传，不是模型性能或未来 SLA。

真实 sendMessage 回执未提供可用 message_seq；实现仍以有效 message_id 确认发送，没有编造历史位置。带有效序号时的路径由本地专项验证。卡片 ACK 和历史可回读不等于客户端渲染验收。

## 未验证

实际 Wi-Fi/热点 A→B→A 切换、OS 网络变化检测及 Provider 自身切网表现没有运行；没有操作系统网络的授权，也不能把受控真实 WS 关闭称为实机换网。真实模型、所有 DM/话题/按钮交互亦不在本轮实网验证范围。HTTP 故障分类只保留通用发送边界，不是用户当前切网路径的前置条件。

95/100 是实施前可执行性评分，不是任务成功率。当前证据支持已受理任务解耦；实机换网未验证，断线期间新消息补收不在本项验收范围。
