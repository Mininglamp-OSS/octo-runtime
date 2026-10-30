---
type: Journal
title: Issue 249 卡片失败诊断与精简终态投递
description: 在最新 main 保留本地链接修复，接通失败响应日志并验证同一卡片的降级终态。
tags: [channel, delivery, testing]
---

# 实施与结果

在原 fix/gateway-card-terminal worktree 同步 main@ed7a4c89 并保留已有修改。Gateway 卡片 dispatch 区分 SEND/EDIT 错误码，通过 Run 诊断记录固定 API 路径、HTTP 状态及先脱敏后截取的最多 200 码点响应摘要；统一日志器限定事件/Extra 放行，组件状态镜像不输出正文。

HTTP 400 不作为业务永久失败。已结束执行的完整卡片帧被明确拒收后，用同一消息 ID 和递增序号有界尝试一次精简终态帧。成功才让 finish 正常完成，保留原失败与降级事实；不能通过吞异常假装原卡片已经结束。其他 HTTP 失败、未知结果、取消和二次拒收保留实际失败，不重跑模型。

构建、类型、lint/命名、格式通过。最终 35 项手动专项通过，覆盖生产模板渲染、HTTP 请求与实际日志文件，以及四种 Runtime 附件回放。全量 WebUI 35 通过；Node 2394 通过、91 跳过、1 项失败；失败用例因本机已有 octo-cli，与未改主线单独复测一致。OctoSpec 仅报告四项主线已有 frontmatter 缺失。

双轴审查发现响应 JSON 字符串绕过敏感字段过滤；已用共享摘要函数及实际日志回归修复，包含截断和内嵌 JSON。Standards 最终复审及 Spec 审查均无剩余确认问题，见[审查](../../tasks/249-local-artifact-card-terminal/review.md)。

无 CI 范围、默认测试入口或脚本改动。用户 18:03 授权完成本地修复、审查、同步 main、提交并创建 PR；不包含合并、部署或重启。线上 IM/真实 Provider/客户端尚未新验。完整命令、限制与记录见[验证](../../tasks/249-local-artifact-card-terminal/validation.md)。
