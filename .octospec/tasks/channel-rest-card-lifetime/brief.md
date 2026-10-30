---
type: Task
title: 切网后 REST 进度卡继续更新
description: 解开任务进度卡与单次 WS 的取消信号绑定。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T00:00:00Z
---

# 切网后 REST 进度卡继续更新

用户确认最终文本能够送达，但任务进度卡停在切网时的思考状态。原因是 CardSession 的 OctoConnector 和 ImDeliveryDispatcher 都使用单次 WS signal；正常重连将其永久取消。REST 本身不依赖 WS online。

进度卡使用原 Bot 生命周期的 REST 客户端和投递器，保留原 API、凭据、收件地址、卡片 messageId 和递增序号。WS 清理不取消进度卡，离线但 REST 可达时也允许更新；Bot 停止仍取消请求，已核验的当前身份变化阻止旧卡继续请求。保持同一 Gateway 服务进程、原 Kernel invoke 和原 CardSession，不新增进程、持久恢复库或公共接口。交互按钮及轮询迁移不属于此次进度展示修复。

验收覆盖真实 REST 序列化与信号：首张进度卡发送后断线，未建立新 WS 仍能编辑同一消息；新连接恢复后终态落在原卡；REST 请求在途时 WS 取消不终止该请求；Bot 停止仍取消；身份改变阻止编辑；短暂 HTTP 失败不能毒化后续终态。保留终态屏障、原发送幂等键与现有 REST 重试上限。专项本地验证，不扩 CI、不提交 Git；沿用本轮 build/install/restart 授权部署可测试版本。

双轴审查补充：Bot 生命周期统一持有卡片/文件的有界投递回执缓存，所有重连 transport 共用；cardDeliveries 直接读取该缓存数量，在新连接鉴权尚未完成时也不能归零。保留每个投递器最多 512 条及文本/卡片分开统计。

PR #251 第三轮核验：a6f769a 仍遗漏独立 replyFailure 的连接级 signal；统一改为 Bot/身份代次的任务 REST 客户端，并透传调用方取消期限。未鉴权 current 不再立即把卡片判为失败，而是在不发 HTTP 的前提下等待下一次成功身份核验，最多 15 秒；同身份继续，换身份永久撤销，任务取消或 Bot stop 立即结束等待。HTTP 自身的 3 秒超时从获准请求开始计算。能力查询与实际提交分别等待/核验，保留未知回执抑制和单次发卡；不扩大 CI，不部署运行中服务。

PR #251 第四轮 Jerry-Xin 核验：e8fc3ae 的异步授权返回后仍有多个 continuation，重连可在实际 POST 前发布未核验 current。将授权改为在 fetch 边界接收并同步执行发送回调，不跨 await 传递许可；429 的每次尝试同样重新准入。回归使用真实 ImRuntime 重连调度，扫描 33 个微任务边界；旧提交在第 10/11/12 个边界均提前发出旧 token POST，修复后全部通过。另验证等待期间迟到 ACK 抑制未知通知，以及成员查询限流后的 HTTP 重试必须等待新身份核验。
