---
type: Task
title: REST 使用 Manager 生效凭据并独立于 WS 恢复
description: 按用户确认的 SDK 嵌入边界取消 REST 对 WS 重新核验的等待。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T02:00:00Z
---

# REST 使用 Manager 生效凭据并独立于 WS 恢复

## 目标与归属

用户确认：WS 与 REST 无建联依赖；只要有合法 bfToken，REST 即可访问。SDK 嵌入时 Extra 由宿主管控，使用 Manager 已生效的 Bot 配置及现有凭据入口即可，不要求取得外部最新 token，不增加刷新、配置文件读取或局部热更新。

授权与配置来源归宿主；Gateway 负责按该配置发起请求、处理真实 HTTP 拒绝、取消和有限重试。修改仅在 channel-gateway 内，不改变 Kernel、Provider、其他 Extra 或 SDK 公共装配合同。

## 当前合同

- token 的获取过程对 Gateway 完全黑盒：宿主 init 装配 Extra，Manager/Bot 保存当前已生效的凭据。REST 在实际 HTTP 尝试前使用 Bot 已持有的值构造 Authorization，不为每次请求重新调用宿主凭据来源，不固定使用旧 WS 回调捕获的 token，不承诺外部新鲜度。已有凭据注入入口的调用时机保持不变。
- WS 清理、重连退避、verify/register/握手未完成或失败不暂停 REST；删除由 WS 恢复驱动的 REST verificationPending 等待。
- token 更新本身不代表 Bot/API/空间改变，不撤销同一身份的 REST 卡片或在途上传。目标身份改变或 Bot 停止仍取消旧投递；WS 文本/文件继续只使用符合原身份与凭据约束的当前在线连接。
- 配置文件或完整 Extra 配置变更仍按宿主停止旧 Extra、保存配置、创建新 Extra 的现有流程生效，不新增 Manager 更新 API。
- 同一 CardSession 保留消息 ID、递增序号和终态屏障；失败通知、未知通知、交互终态、附件 presign 和成员查询使用相同 REST 规则。
- HTTP 的每次既有 429 重试读取 Bot 已持有的有效凭据；对象存储 PUT 只使用签名 URL/头，不携带 bfToken。已发出的请求不因 token 变化自动重放，未知上传和未知消息不重放。
- HTTP 请求有限时且受 Bot/任务取消约束；缺失或格式错误明确失败，不因 WS 状态阻止已有授权。迟到 ACK/obsolete 在实际发送前继续抑制过期通知。

## 验收与范围

先通过受控 HTTP/WS fixture 复现“旧连接 close 未完成而 REST 被阻塞”，再验证清理、退避、未核验 WS、握手失败期间 REST 正常完成；验证生效凭据用于 profile/POST/429/presign，PUT 不泄露 token，授权缺失/HTTP 拒绝/任务取消/停止/身份切换仍有效。保留 WS 未知不重放、ACK 账本和卡片终态合同。

更新已有断言以匹配本次明确的合同；新增专项仅显式本地运行，不改 workflow、job、矩阵、触发、必需检查、CI Gate 或默认测试入口。用户要求将黑盒凭据边界写进架构设计、英文 commit message 及 PR 评论；完成验证后提交到既有 PR #251，不发布、不重启服务。Issue #250 涉及 OpenClaw 执行流恢复，本次不关闭。
