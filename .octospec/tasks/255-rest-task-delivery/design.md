---
type: Design
title: Issue 255 来回换网恢复逻辑与可执行性评估
description: 以 Bot 身份生命周期保留任务并用 REST 完成出站，定义收益、失败边界和试验方法。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T00:00:00Z
---

# 收益与恢复路径

本需求前提是用户确认的“切网只影响 WS，HTTP 正常”。以下 HTTP 故障条目仅说明既有发送失败边界；正常 REST 直接发送，不先检测或等待 WS/网络恢复。

| 场景 | 现状 | 目标 | 用户收益 |
| --- | --- | --- | --- |
| REST 恢复、WS 未恢复 | final 等在线连接，最多等 15 秒后失败 | HTTP 可发即投递 | 已完成工作更快可见，不取决于 WS 最终是否恢复 |
| 已排队任务等待时切网 | 闭包检查旧连接 closed，Context/图片继承旧 signal | 用 Bot 身份与本轮 signal 准备 | 下一条仍能执行，无需重新发送任务 |
| A→B→A 反复切网 | 每次切换重新选择 final 的 WS | 只重建接收连接，同任务继续使用 REST | 卡片、结果与队列不随 WS 来回重置 |
| HTTP 同时不可用 | API 自身失败 | 有限超时与准确投递失败/未知 | 不虚报成功、不重新跑模型；不是无限离线补投 |
| 切网时新任务尚未送达 | 既有 WS 接收边界 | 用户明确不纳入本需求，不增加补收机制 | 保持单一任务入口和既有接入复杂度 |

## 两条独立状态链

WS：online → 发现断线 → 清理旧连接 → 既有快速重连/退避 → 新连接 online。再次切网重复此链；仍然串行持有一条活动接收连接。

任务：受理 → 有界 FIFO 排队 → Context/图片准备 → 唯一 invoke → 真实终态 → REST 卡片收尾/最终消息 → 释放。WS 转换不改变这条链；任务自身取消、Bot stop 或身份撤销才终止适用阶段。Provider 的网络故障仍按执行合同报告。

具体时序：A 网络收到 T1/T2/T3，T1 运行、T2/T3 排队；切到 B 时旧 WS 被清理，但任务和卡片归属保持。B 的 REST 可用时 T1 交付并让 T2 前进，期间即使 B 的新 WS 握手一直失败也继续。再切回 A，T2/T3 不重新 invoke，不重新上传已准备产物，不新建原卡；WS 恢复后只接收后续消息。finalMsg 和卡片 finish 的暂态投递错误仅在当前收尾内重试，首发后最多 3 次，成功即停；耗尽在 channel-gateway logs 记录错误码及 run_id 后结束。普通卡片快照失败不重试。无回执不记为送达，不因后续网络恢复另开补投、持久保存待发结果或重新执行任务。

## 实现位置

### 原有耦合与本次删除

此前的增量修复在同一个连接对象上叠加了收任务、发结果、确认送达及跨连接恢复。问题不只在心跳快慢：HTTP 可以使用时，任务准备与最终结果仍可能被旧 WS 的取消、关闭状态或新 WS 的握手阻塞。发送是否成功又要关联重试序号、迟到 ACK、身份缓存和未知通知，连接恢复与结果投递因此互相牵制。

| 原有职责混用 | 当前归属与处理 |
| --- | --- |
| 任务准备闭包继承接收 WS 的 closed/signal | 受理后归 Bot/任务所有；WS 关闭不作废排队、Context/输入/环境或 AgentRun |
| final 选择当前 WS、最多等待 15 秒，再由 WS 发送 | 普通回复、finalMsg、文件与卡片统一 REST；REST 发送前不读取 current transport |
| WS 业务 SEND 以 15 秒 ACK 窗口及 1/5/10 秒间隔重试，最多等待 76 秒 | 整条发送状态机删除；当前 REST finalMsg/finish 使用自身有限预算 |
| 发送序号映射、活动发送集合、30 秒迟到 ACK 保留及 onDelivered 回调 | 全部删除；仅在 Bot 内存保留有界 REST 成功回执，防止重复发同一 effect |
| 投递未知再发送独立通知卡，并用迟到 ACK 抑制通知 | 通知接口、通知卡工厂、分支及投递查询接口全部删除；失败只记日志后结束 |
| 接收 ACK 与业务投递确认共用连接状态 | 接收 ACK 仅应答入站协议；REST 有效 message_id 才确认业务消息投递 |

用户已明确不考虑旧业务发送 API 的兼容性，因此直接删除公开 WukongConnection 的 sendText/sendFile/isDelivered 与构造参数 onDelivered，不保留废弃方法、转发包装或备用 WS 路径。WukongConnection 本身继续提供接收连接能力。没有新增网络变化订阅、HTTP 可用性探测、结果持久化或离线新任务补收。

保留的连接状态只服务注册/握手、入站消息/规则及接收 ACK、10 秒 PING/一个 10 秒 PONG 周期、连接关闭与串行重连。Bot 身份撤销、任务取消、队列准入、历史会话代次及 REST 回执防重分别归其原所有者，不因删除传输耦合一并取消。

1. transport/connector.ts：复用现有 postJson 和 REST 授权，为文本/文件 payload 提供同一消息发送入口；3 秒单次 HTTP 预算，message_id 确认、有效位置观察、网络未知分类。
2. transport/channel.ts：删除 reply/replyFinal 对在线 WS 的选择和 15 秒等待；保留产物准备缓存；同次在途 effect 共用发送 Promise，失败返回本轮投递器，确认后写入有界身份账本。普通回复、文件、final 共用 REST 工厂和原任务 signal/obsolete。
3. 已准入消息的 executionEnvironment/buildContext/buildInputs/markRead 改为 Bot/任务身份期限。Context 准备使用原配置/来源和既有取材策略，不把失败材料伪装为成功。执行环境独立于模型材料。
4. application/im-channel.ts：增加仅用于已接纳任务 REST 位置的回调，独立于当前 WS 的回调过滤，继续由原 session/generation/processEpoch 防止过期历史写入。不新增公开 SDK 接口。
5. 原有测试按新发送合同调整；后续用户明确不考虑旧业务发送 API 兼容，删除已移除 WS SEND/迟到 ACK 及未知通知的专属测试，原入站加密解析、接收 ACK、心跳及重连覆盖保留。取消、身份及重复发送场景改为验证实际 REST 路径。新增专项放本目录 regression.mjs 手动执行，不扩大默认 CI。
6. delivery/dispatcher.ts 显式收尾预算为首发加最多 3 次重试；仅 finalMsg 和 CardSession 的终态设置该预算，普通过程帧仍为单次。final 失败后只写日志，不追加投递未知通知；service-status.ts 定向允许 Gateway 投递错误码和 run_id 进入现有 CLI 日志视图，不输出正文或凭据。

## 验证矩阵

| 编号 | 证据与通过标准 |
| --- | --- |
| V1 | 原版相同 fixture：WS 永不恢复时 final 不能及时发送、排队消息准备被旧连接拒绝；修复版不调用 sendText/sendFile，HTTP 返回后即时收尾 |
| V2 | 一条运行、四条排队，A→B→A→B 多次 retirement，唯一 invoke、FIFO 和容量拒绝保持，发送者/目标/环境不串用 |
| V3 | Context/图片准备前及进行中 retire 原 WS；任务 signal 不取消；Bot stop/身份拒绝仍阻止准备和后续发出 |
| V4 | 文本/文件确认、丢响应、429、403、缺回执、重复 effect、stop/reset、身份换回及同身份换 token；final/finish 首发加最多三次重试、普通卡片单次、CLI 默认日志可读，失败后不补投或重跑 |
| V5 | 原卡消息 ID/序号与终态保持；mention 的 UTF-16 偏移、附件缓存、REST message_seq 和缺位置保守历史保持 |
| V6 | pnpm typecheck、pnpm lint、lint:names 与相关现有 channel/gateway 回归；手动专项显式运行；git diff --check、相对 main 的 workflow/默认入口 diff 为空 |
| V7 | im-test 实网：记录 REST 可用、发送回执/回读、WS 恢复三个时间；受控关闭 WS 与真实 Wi-Fi 切换分别记录。只验收已受理任务，断线期间新消息不发送、不验收补收 |

## 可执行性评估

实施前准备度 **95/100**，不是成功率或已完成比例。

| 项目 | 得分 | 依据与扣分 |
| --- | --- | --- |
| 需求价值与范围 | 20/20 | 用户给出切网约 20 秒及 WS 可能不恢复，收益对应已受理任务的延迟与成功交付 |
| 责任与生命周期合同 | 20/20 | Bot/task/WS/身份代次、取消、队列与 Provider 边界明确，不改公共执行协议 |
| 实现定位 | 24/25 | REST sendMessage 已有，message_id/message_seq 类型已有；待实测文件 payload 与回执字段兼容性，扣 1 |
| 故障与重复控制 | 19/20 | 同次在途 Promise、稳定消息身份、有限收尾请求、身份撤销和保守历史；HTTP 丢回执不能保证送达或端到端 exactly-once，扣 1 |
| 验收可执行性 | 12/15 | 现有 fixture 可复现并可比较旧版；实际 Wi-Fi 切换需环境支持，扣 3 |
| 总计 | 95/100 | 实施可开始；实网和系统切网证据未取得前不宣称端到端恢复通过 |

本次禁止为切网新增任务接收路径、持久队列、服务端协议、新配置选项或宿主/SDK 接入要求；不改造通用执行层。不得把既有卡片动作轮询扩展为任务消费。约束正文见[架构规则](../../rules/architecture.md#channelgateway-任务接收与投递边界)。实现中若出现不能按上述合同验证的关键缺口，更新评分和具体限制，不用扩大 CI 掩盖。
