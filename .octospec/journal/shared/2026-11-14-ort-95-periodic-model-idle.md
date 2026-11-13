---
type: Journal
title: ORT-95 周期静默通知实现与验收边界
description: 源端周期进度与待发事实分离，记录本地通过和真实渠道前置条件。
tags: [runtime, canonical, stream, integration]
---

# 结论

`main@8376be62` 的每段一次 reported 已在 ORT-95 独立工作区替换为源端周期进度，尚未提交或发布。同段正常消费在60/120/180秒发新通知；迟到只报告当前事实一次。静默段对象也作为身份，不能仅按相同时间戳判断重置；订阅与timer另有身份，旧detach/callback不得影响新状态。

背压只留一个槽。已生成事实不按交付延迟改写，同段取走后跳过已错过节点，旧段槽取走不能推进新段。Core 原有 source next、已生成通知先交付及终态优先保持，不重构执行循环。

本地受控专项27通过，opt-in真实四分钟Kernel/client测试另行通过；全量1403通过、61既有条件跳过。四种enforce预算专项及双语合同同步，GitHub CI/default测试范围未扩大。

真实Gateway卡片验收仍缺ORT-93消费实现；双轴子代理现场工具权限失败，只能进行有限补丁审查，主执行者完成最终diff复核。因此本轮回到规格审查，不将本地通过等同完整交付。细节与恢复条件见[验证](../../tasks/ort-95-periodic-model-output-idle/validation.md)和[审查](../../tasks/ort-95-periodic-model-output-idle/review.md)。
