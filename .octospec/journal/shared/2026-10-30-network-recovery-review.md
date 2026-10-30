---
type: Journal
title: 网络恢复修复双轴审查与本地安装
description: Standards 与 Spec 独立审查，各发现一项 P2，修复复核并安装。
tags: [channel, delivery, lifecycle, testing, review]
timestamp: 2026-10-30T00:00:00Z
---

# 网络恢复修复双轴审查与本地安装

用户显式调用 code-review 并要求 build/install -g local。审查基线固定为 8b239e47231deed4c135b9b5add816484d17bb7f，范围为该基线到当前工作区的未提交修改；没有新增提交，使用 git diff 基线检查工作区，不以空的三点提交差异代替实际修改。需求来源为 channel-immediate-reconnect、channel-reconnect-final-delivery、channel-rest-card-lifetime 三个任务说明及本轮用户指示。预存 .workbuddy/ 不属于本次修改。仓库缺少技能的 docs/agents/issue-tracker.md，已提示可运行 /setup-matt-pocock-skills；本次直接采用已具备的本地需求来源。

## Standards

独立审查发现 1 项 P2：按消息创建的新投递器保存了卡片/文件回执，但 cardDeliveries 只读取连接旧投递器，违反 stateless-execution.md 的当前保留回执总数合同。修复为 Bot 生命周期持有一个专用有界投递器，所有重连 transport 共用；状态直接读取 owner.dispatcher，鉴权/注册尚未完成时也不会归零。每个投递器仍最多 512 条，文本与卡片数量分开。真实 Runtime 重连测试及文件测试断言回执计数，新 transport start 前断言保留旧计数。审查者复核后剩余 0 项。

## Spec

独立审查发现 1 项 P2：普通终态回复分支丢失 finalOptions.signal，空回复/失败/取消提示等待重连时收到 /stop 后仍可继续发送。违反原任务取消期限要求。ImInboundMessage.reply 增加兼容的可选投递参数，Runtime 透传 signal/obsolete，transport 合并 Bot 与该轮信号并在等待前后检查过期；原普通提示不进入产物/mention 准备。新增真实 Runtime 的 /stop 和 /reset 回归，确认只发控制确认、不发旧空终态提示且仅 invoke 一次。审查者复核后剩余 0 项。

## 验证与安装

最终代码全量 build、根 TypeScript noEmit、修改文件 Prettier、git diff --check 通过；本轮 lint 通过。六组相关测试共 188 项全部通过，日志 /tmp/octo-runtime-review-tests.log。workflow、脚本、根 package.json 和 pnpm-workspace.yaml 无 diff；未扩大 CI、未创建 Git 提交。

pack-release 在产出 tgz 后仍因 npm 12 JSON 返回形状报错。独立核验 68 个依赖及传递依赖、bundleDependencies、四个 Gateway JS 及 build-info 后，用离线 npm install -g 安装成功。安装前 6 个 Bot 均空闲，沿用此前重启授权停止 Gateway/Kernel，安装后先启动 Kernel 再启动 Gateway。

构建时间 2026-10-29T17:40:42.647Z（北京时间 01:40:42），来源 8b239e47231d dirty。Kernel PID 26102、Worker PID 26106 ready，Gateway PID 26735；6 个 Bot 全部 online/error=null，kernel_available=true。已安装 JS 和 build-info 与审查后构建逐字节一致。没有代发消息或主动切网；真实切网复测仍由用户执行。

结论：Standards 1 项 P2 已修复，Spec 1 项 P2 已修复；两个方向最终剩余均为 0。

## 提交 PR 前同步最新 main

用户随后授权提交 PR 到 main，并要求先 rebase 最新 main。创建 fix/channel-network-recovery 分支，抓取并 rebase 到 4e607dc0f8bac1a63422f9e03a8b46017841a5ac（#247），保留配置的 Git 作者以及英文提交和 Codex trailer。

Git 无文本冲突，但上游连接 close 新增无条件 CardSession.release，导致真实重连后的卡片更新失效；初次集成回归 7 项失败确认语义冲突。调整为正常重连仅清理按钮映射，活跃 REST 卡由原任务 finish 释放；任务已结束、没有 Bot owner 或 Bot 已停止时继续采用连接回收兜底。回归额外断言重连不 release 活跃卡，任务结束只 release 一次。

最终全量 build、根 TypeScript noEmit、lint、lint:names、全仓 format:check 通过；最后新增断言用 Prettier 格式化，git diff --check 通过。渠道相关测试 `test/im-*.test.js test/channel-*.test.js test/gateway-*.test.js`（并发 2）513/513 通过；上游四个 projection-window 手动专项（含显式 GC）41/41 通过。未将专项加入默认 CI，目标分支相对 workflow、脚本和入口配置无差异。

本地服务仍运行此前已安装版本；此次 rebase 后版本通过上述离线集成验证，未重新部署或代发真实消息。不将此前用户切网观察当作 rebase 后版本的线上验收。

## Jerry-Xin 的 PR 意见核验与修复

核验 PR #251 review 5702658201，基线 c283808。问题成立：replyDeliveryUnknown 的 OctoConnector 未设置请求授权回调；原 WS 发送确认未知后，重连身份变化仍会用旧 token/config 查询能力并发送通知。此问题与正常同身份切网不同，不表示每次换网都会换身份。

先增加 12 项回归：凭据/API/空间/Bot 变化各覆盖通知前和能力查询返回前两个时机，另以同身份恢复、无新 WS 但 REST 可达作为正例。修复前 8 项身份变化断言失败、4 项正例通过。修复将原进度卡检查提取为共同 REST 授权方法，并用于未知通知的每次请求，保留 Bot 生命周期取消和原未知消息不重放。

修复后 6 组相关测试 200/200 通过（日志 /tmp/octo-runtime-jerry-tests.log），全量 build、根 TypeScript noEmit、lint、修改文件 Prettier 与 git diff --check 通过。没有修改 workflow、脚本或默认测试入口，没有代发消息或更改运行中服务。

审查提到的旧 CI run 40925449476 单独核验：Windows Node 24 job 123629601527 在 Verify Windows installation and independent component cleanup 的 Offline npm install 阶段，触发既有 60000 ms 超时，stdout/stderr 为空。未将该失败归因于此次 REST 代码，也未修改 CI 超时或范围；新提交沿既有 PR 触发条件重新验证。

## 三位审查者第二轮意见核验

用户要求核验所有审查意见并请所有审查者重新 review。核验基线 adf2447，最新审查为 Jerry-Xin 5702954820、mochashanyao 5702981842、yujiawei 5703044181。

- Jerry-Xin：新 current 尚未完成 verify 时旧 REST 被放行，成立。守卫在不同 current 未持有已核验 token 时拒绝请求；同身份核验完成可恢复，不以 WS online 为前提。
- mochashanyao：附件准备中途切身份后仍继续旧上传，成立。Bot 持有 ImDeliveryIdentity，每次成功身份/空间准入后取得投递代次；换 Bot/API/空间/凭据取消原代次，原任务准备、HTTP 和 WS 均使用该信号。presign 与 PUT 入口各自再校验，已开始请求通知取消，不承诺撤销服务端已接受的数据。
- mochashanyao：A → 已核验 B → 未核验 C 会复活 A，成立。身份代次在 Bot 生命周期内保存；即使之后重新使用 A 的凭据，也不会复活 A 的旧任务或确认账本。
- yujiawei：交互卡收尾仍用被取消的旧连接 REST，成立。创建过程中及已显示卡的 resolve/finish 改用任务级 REST connector，按钮已接纳响应后的编辑复用同一 resolveInteraction，只有确认编辑成功才删除关联。旧按钮轮询不迁移；连接回收后拒绝通过旧绑定创建新的交互。
- yujiawei：中间连接的确认不再可见，成立。成功 WuKong ACK 通过回调进入身份代次内最多 512 条的确认账本，后续发送及未知通知查询该账本；不持有所有历史连接，也不跨身份/重启持久化。真实二进制 WS fixture 验证成功文本/文件 ACK 回调，失败 ACK 不记账。
- yujiawei：普通上传、群成员或私聊用户查询的临时故障导致 finalReply.value 永久拒绝，不成立于现有实现。prepareArtifacts 捕获普通单文件故障并返回部分成功与失败说明；prepareFinalMention 捕获成员查询故障并返回无 mention 正文。新增三项真实 replyFinal 回归，在修改前就通过，正文照常送达，重复进入同 effect 不重复已完成上传。取消或身份撤销不能以清除 Promise 为由恢复旧准备，因此保留缓存合同并补充注释，而非无条件重跑未知上传。

初始 13 项定向核验：8 失败、5 通过，日志 /tmp/octo-review2-before.log；失败覆盖鉴权空窗、连续换身份、附件中途换身份、交互卡收尾和中间连接确认。实现后增加账本边界及代次隔离回归，并在现有真实 WS 测试验证 ACK 写入；交互发卡用请求已开始时切网及已有卡两种时序验证。最终渠道测试 539/539 通过（/tmp/octo-review2-channel-tests.log），全量 build、根 TypeScript noEmit、lint、lint:names 通过。未修改 workflow、CI 脚本、默认测试入口或范围；相对 main 的这些路径 diff 为空。旧 adf2447 的 GitHub CI Gate 已成功；新提交仍需独立 CI 和三位审查者复核。当前本地服务未重新安装/重启，线上切网未在本轮复测。

## yujiawei 第三轮：失败卡遗漏与鉴权等待

用户指出仍未修复后重新读取 a6f769a 上的 review 5706779195；两条均成立。mochashanyao 的 review 5706764670 也指出失败卡遗漏（其评为非阻塞 P2）。上轮修复覆盖的交互卡不等于独立 replyFailure；该分支仍因旧 WS abort 直接返回。另一个遗漏是把未鉴权当作立即失败，虽然没有用旧身份写入，却会丢掉一次性卡片/通知。

统一 restDelivery 工厂为失败卡、未知通知和进度/交互卡生成 Bot/身份代次级 REST 客户端。replyFailure 接受调用方 signal/obsolete，Runtime 的失败通知透传取消与收尾期限；未提交失败在通知前登记 finalDeliveries，让 /stop、/reset 取消错误卡和文本。原通知取消不触发新的副作用或递归失败通知。

ImDeliveryIdentity 提供成功核验事件的可取消等待；未核验 current 的请求最多等待 15 秒，失败的认证尝试不提前消耗该通知，同身份核验成功后继续，换身份永久撤销原代次。等待期间不发 HTTP；OctoConnector 的 HTTP 3 秒期限在授权完成后才建立。能力查询和写入各自等待/核验，附件 presign/PUT 及 mention 查询同步遵守异步授权。等待者在成功、取消或超时后清除，成功 ACK 仍能抑制等待期间过期的未知通知提交。

定向复现并验证失败卡在旧 WS 取消后继续、三种卡片在 profile 前/写入前的鉴权空窗、同身份恢复、换身份、Bot stop、任务取消、一次认证 503 后再次恢复及超时。保留上一轮已撤销身份不能复活的回归，将“尚未鉴权立即失败”验收改为“等待且不出站”。增加真实 Runtime 的 /stop、/reset 两项取消权透传测试。全渠道回归 553/553 通过（/tmp/octo-review3-tests.log）；全量 build、根类型检查、format:check、lint:names 通过。lint 指出等待取消不能 reject 非 Error 值，已规范化该边界并补跑 Gateway 构建、相关测试和 lint，结果在本轮 PR 评论列明。CI 配置、脚本和默认入口相对 main 无 diff；未安装或重启当前本地服务，真实 Wi-Fi 切换未在本轮执行。

取消错误类型修正后，Gateway 构建、完整 lint 及 artifact/pre-execution-failure 两组测试 111/111 再次通过（/tmp/octo-review3-focused-final.log、/tmp/octo-review3-lint-final.log）。

## Jerry-Xin 第四轮：授权与实际 HTTP 出站之间的竞态

核验 review 5706932239，基线 e8fc3ae。意见成立：authorizeRestDelivery 返回后，任务工厂、requestSignal 和 card 各自的 await 仍让出执行权，新的 current 可以在 POST 前发布；身份代次尚未撤销并不能证明该 pending current 已核验。

在 HTTP 基础层加入内部 fetchWithDispatch 入口，所有相关请求在实际 fetch 前进入同一身份守卫；守卫在成功检查后同步执行发送回调，不返回供异步调用方使用的许可。能力查询、失败/进度/交互/未知卡片、附件 presign/PUT 和 mention 查询均接入，JSON 的 429 重试逐次重新准入。Bot/任务/身份取消、15 秒有界核验等待及卡片发出后的 3 秒 HTTP 期限继续保留。未知通知等待期间收到成功 ACK 时，发出前抑制通知且正常完成。

使用真实 ImRuntime 重连调度和 GatewayTransport/OctoConnector，仅隔离网络、WS 和计时器。33 个微任务边界扫描在基线第 10/11/12 个位置失败（/tmp/octo-race-baseline.log）；修复后 33/33 通过。另两项验证迟到 ACK 与 429 重试，35/35 通过（/tmp/octo-review4-races.log）。不扩大 CI，不安装或重启运行中服务。

最终验证：完整 workspace build、根 TypeScript noEmit、lint、lint:names、format:check、git diff --check 通过；全渠道/网关测试 588/588 通过（/tmp/octo-review4-tests-final.log）。第一次将依赖 dist 的 lint/测试与全量 build 并行，build 清理产物时造成模块缺失；该轮不作为功能结论，构建结束后重跑上述检查全部通过。相对 main 的 .github、根 package.json、scripts 和 workspace 配置无 diff；远端旧 head 的检查列表仍为现有 CI/审查项目。真实 Wi-Fi/Provider 验收未在本轮重跑。

## yujiawei 第五轮：旧连接回收至替代连接发布之间的空窗

核验 review 5707199541，基线 90f7a89。意见成立：真实 ImRuntime 在 onDisconnect 后先等待 close，再调度重连，期间 current 仍指向旧 transport；单靠 current 的 token 检查无法表示正在重新鉴权。通过可变凭据源与受控的旧 WS close，在清理阶段及重试计时器尚未触发阶段复现旧身份请求提前发出。新增 7 项回归在基线均失败（/tmp/octo-review5-before.log）。

ImDeliveryIdentity 由 Bot 持有 verificationPending，Runtime 在回收前、发起连接前及已核验后的注册/握手失败时同步设置；仅 accept 成功身份时清除。实际 HTTP 守卫先等待 pending，再保持检查与 fetch 同步执行。纯 REST-only 离线没有声明重新鉴权时仍可继续，已核验而 WS 尚未上线也可更新；不取消原 Run、不永久撤销同身份恢复的代次。

8 项新回归通过（/tmp/octo-review5-retirement.log）：清理/退避期间同身份继续与换身份拒绝，任务/Bot 取消，15 秒截止，以及 verify 完成即允许 REST、握手失败后重新等待。原 33 项 dispatch 时序、迟到 ACK、限流重试和 REST-only 正例也继续验证。本轮自动检查不安装或重启本地服务；用户刚安装的版本仍为 90f7a89。

最终验证：全量 build、根类型检查、lint、命名、format:check 与 diff whitespace 通过；全渠道/网关测试 596/596 通过（/tmp/octo-review5-tests.log）。相对 main 的 workflow、根 package.json、scripts 和 workspace 配置无 diff；90f7a89 的既有跨平台 CI Gate 已通过，新提交仍须独立 CI 与 review。

## 托管 CI：快速重连的瞬时状态采样

1878df7 已获 yujiawei approve（review 5707284520）。CI run 40989253617 的 macOS Node 26 单项失败：recovery-dual-mode.test.js:168 等待 SDK status 查询捕获 retrying，2 秒后 condition timeout；其余五个平台/Node job 成功。该测试仍假设退避期间能轮询看到 retrying，立即重连后此假设不成立。失败日志 /tmp/octo-pr251-macos26-failure.log。

将五轮断线的中间状态证据改为本轮 channel.disconnected 日志中的 retrying 与精确断开原因，仍必须观察新连接恰好增加一次、状态 online、真实回复以及 Provider 接纳次数。没有加超时、skip、测试选择、workflow 或 CI 范围，也不修改生产行为。旧测试本地 Node 24 的 CLI/SDK 2/2 通过，未声称稳定复现托管 Node 26 失败。修改后 recovery-dual-mode、连接状态机、状态日志三个文件 106/106 通过（/tmp/octo-review6-tests.log）；托管 Node 26 仍须新提交 CI 验证。
