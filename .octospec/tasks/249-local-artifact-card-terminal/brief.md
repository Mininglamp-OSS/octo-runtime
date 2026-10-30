---
type: Task
title: Issue 249 本地附件交付后的执行卡片收敛
description: 复现终态编辑被本地 Markdown URL 拒绝并在卡片展示边界修复。
tags: [channel, delivery, testing]
---

# Issue 249：本地附件交付后的执行卡片收敛

## 目标与证据

- Issue：https://github.com/Mininglamp-OSS/octo-runtime/issues/249
- 初始基线：`origin/main@8b239e47231deed4c135b9b5add816484d17bb7f`；交付前同步到 `ed7a4c89`。
- 独立分支：`fix/gateway-card-terminal`。
- 用户两张截图均显示模型最终回复已交付、执行进度卡片仍为活动状态。第二张 HTML 文件卡交付成功，证明 SVG 上传拒绝不是必要条件。

## 分析与实施边界

现有编排先完成展示 finish，再准备附件与发送 final。附件准备会保留成功 URL、报告单项失败，不修改执行终态。重点核验：final/公开进度进入卡片文本摘要时，本地 Markdown 引用是否违反服务端绝对 HTTP(S) URL 合同，造成终态编辑失败而 final 仍正常交付。

在 Gateway 卡片展示边界修复公开文本的 Markdown 表达；保持执行源事件、projector 正文、最终附件引用、上传权限和真正执行终态。失败投递不得重跑模型。卡片展示失败仍保留诊断及关闭 incomplete，不能虚报成功。

## 验收

1. 用实际 projector、CardSession、REST connector 和服务端实际模板渲染器重现并验证终态编辑。
2. PNG/HTML 本地引用上传成功、SVG 被拒与部分成功均不会使终态卡片停留进行中。
3. 覆盖绝对/相对/file URL、引用式链接及摘要截断；只在显式手动回归中增加专项。
4. 本地运行相关现有卡片、附件、运行、停止与 drain 回归以及类型和静态检查，记录真实边界。
5. GitHub workflow、默认测试入口、脚本、必需检查及 Gate 不扩大。初始阶段只做本地实现；后续提交按最新授权执行。

## 2026-10-30 继续修复

用户授权在原 worktree 继续实施可观测性及可靠终态收尾。同步 main@ed7a4c89 并保留已有纯文本修复。卡片 dispatch 的失败回执区分 IM_CARD_SEND_<status> / IM_CARD_EDIT_<status>，通过原 Run 诊断链路记录固定 API path、HTTP 状态及先脱敏再截取的最多 200 码点响应摘要；统一日志器仅对此 Gateway 事件放行，不进入组件状态镜像。

HTTP 400 只说明当前请求失败，不能据此判断业务永久失败。已确认执行终态的富卡片收到明确 400 后，沿同一消息 ID、新递增序号尝试一次精简终态帧。降级投递确认成功则 finish 正常返回，保留原 400 和降级诊断；降级也失败仍如实报告收尾未完成。未知投递不自动降级重发，其他 4xx 不统一吞掉，也不重新执行模型。

决定权归 Gateway 展示/投递层：不修改执行源终态、附件/最终回复、宿主凭据获取或其他渠道策略。专项只显式本地执行；不增加 CI 范围。

18:03 用户进一步授权本地修复、code review、同步最新 main、提交并创建 PR；不包含合并、安装或部署。双轴审查和修复记录见 [review](review.md)。

可执行性：96/100。缺少现场原始帧及线上卡片拒收日志，因此局部复现能证明代码缺陷，不能宣称已核验原截图的唯一原因。服务器只读核验，不修改其代码。
