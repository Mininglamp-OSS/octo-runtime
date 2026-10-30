---
type: Review
title: Issue 249 卡片终态修复双轴审查
description: 对最新 main 上的本地修改分别核对编码约束和 Issue 249 需求。
tags: [channel, delivery, review]
---

基线：origin/main@ed7a4c899e5666238bc67e6a8418e3805ac924da；比较工作区修改及新增的显式手动专项。依据 Issue 249 和用户关于 HTTP 状态、终态收敛、可观测性、CI 范围的补充约束。使用 code-review 技能的独立 Standards / Spec 审查。

## Standards

发现并修复一项 P1：原实现对响应 JSON 字符串直接调用 sanitizePublicValue，绕过结构化敏感字段过滤。authorization、cookie、credential、private_key 等随机凭据可进入诊断回调及落盘摘要，违反凭据日志约束。

改用共享 sanitizeDiagnosticBody：先解析 JSON 并结构化脱敏，再保守移除敏感键后的摘要内容，最后截取 200 Unicode 码点。非 JSON、被 API 错误层截断的 JSON、message 中的 header 和内嵌 JSON 同样经过过滤；Unicode 转义文本不能完整判读时不公开正文。dispatcher 和实际日志边界独立使用该函数。代价是包含敏感内容时可能省略后续普通错误详情。

手动专项覆盖五类凭据键乘五类正文形态，分别核对 dispatcher 回调和直接调用 RuntimeLogging 的真实文件输出。新增专项不进入默认测试或 CI。复审期间发现的 message/header 和内嵌 JSON 绕过已逐一补测修复。

最终 Standards 独立复审通过：直接导入最终 TS 源码执行 30 个探针，包含重复嵌套 JSON，均未泄露测试凭据；重复调用保留业务错误码且不超过 200 码点。原 P1 已关闭，当前没有确认的待修项。

## Spec

未发现确定的阻断问题：卡片展示副本去除链接语法；SEND/EDIT HTTP 失败携带路径和脱敏摘要；明确 400 后只对同一卡片、新序号有界降级一次；确认终态投递成功才让 finish 返回；未知投递或降级失败不伪报成功。模型执行、真实终态及附件正文不改写。

排除两项未被证实的猜测：真实 ImTask.events 在确认执行流耗尽后才输出 terminal；精简帧增长仍在原 builder 的 128B 余量内，低预算本地回放没有超限。没有据此增加无依据的重试或预算改动。

现场原始拒收帧和桌面客户端验收未获取；本地受控验证不能证明历史截图的唯一原因。完整测试结果及现有主线失败见 [validation](validation.md)。
