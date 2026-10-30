---
type: Journal
title: 明确宿主黑盒凭据与 REST 独立传输边界
description: 用户纠正以 WS 重新核验阻塞 REST 的设计，记录本轮实施与验收。
tags: [architecture, channel, delivery, testing]
timestamp: 2026-10-30T02:00:00Z
---

# 设计决定

用户明确：Extra 在宿主 init 时启动并由宿主管理，token 如何获取对 channel-gateway 完全黑盒；使用 Manager/Bot 已持有的生效凭据即可，不要求外部最新 bfToken。WS 与 REST 独立，不能因重连而要求已有 REST 授权重新等待 WS 鉴权。

此前 PR #251 review 通过 verificationPending 覆盖旧连接回收窗口，但该规则把 WS 恢复与 REST 重新耦合。本轮删除此等待，在 Bot Runtime 沿原凭据注入入口保存值，HTTP dispatch 同步读取该值、检查目标/取消并填入鉴权头。REST 不重新调用凭据来源，不新增配置热更或刷新 API；原生 WS 的当前连接与凭据检查保持。仅 token 改变不再撤销目标身份的 REST scope，Bot/API/空间改变仍隔离并取消旧 scope。

架构规则与当前 Channel 合同已更新；旧 review 任务加上当前合同入口，以避免把历史等待策略作为现有要求。用户要求英文 commit message 与 PR 评论明确上述边界。

本地验证 605 通过，包括原 596 项渠道回归、CLI/SDK 恢复 2 项和手动 REST 凭据专项 7 项；完整命令与实际边界见[验证记录](../../tasks/channel-rest-manager-credentials/validation.md)。真实 Wi-Fi/Provider/IM 未复测，未部署。

Issue #250 描述的是 OpenClaw provider 执行流的恢复、失败分类与终态确认；本次只覆盖渠道投递和 REST 生命周期，不能用 PR #251 关闭 #250，也不把 retryable 元数据等同于自动重跑模型的授权。
