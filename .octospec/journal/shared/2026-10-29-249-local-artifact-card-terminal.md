---
type: Journal
title: Issue 249 本地附件导致卡片终态编辑被拒绝
description: 记录本地合成回放的根因、展示修复、专项与现有回归，以及未进行的线上验证。
tags: [channel, delivery, testing]
---

基于最新 main `8b239e4` 新建独立 worktree 和英文 [Issue 249](https://github.com/Mininglamp-OSS/octo-runtime/issues/249)。按 [简报](../../tasks/249-local-artifact-card-terminal/brief.md)核对 CanonicalEvent、展示终态、附件交付与关闭合同。

本地复现确认：final 被保留在 model_step 摘要中，原转换保留本地 Markdown URL；生产服务端模板渲染后的 URL 校验拒绝整个 completed 编辑。生成完成和文件上传仍可成功，因此旧卡片停留 reasoning。不是图片专有故障，也不能把 SVG 上传失败当作卡片失败的必然原因。进度与终态均为整次卡片 REST 更新，最后一次被拒绝时没有后续进度替换；必须区分执行成功与卡片成功应用终态。

仅在 Gateway 展示副本上将摘要、动作及诊断转为纯文字，保留 final 原 Markdown 供附件交付。空 alt 不产生空必填字段，错误码及诊断编号仍保留完整预算。首次相关回归识别出诊断编号下划线转义问题，已修正。

专项 19 项、现有相关回归 192 项全部通过；完整构建、最终 Gateway 构建、根类型检查、lint/命名/格式检查通过。生产 Go Registry.Render 对 0.4.0/0.4.1 实际模板验收；完整 Runtime 回放的 HTTP/WS 和 Kernel 源是受控替代。具体矩阵、命令、历史代码依据及限制见 [验收记录](../../tasks/249-local-artifact-card-terminal/validation.md)。复用合同已回写 [Channel 规则](../../rules/channel-integration.md)。

OctoSpec 全仓 lint 被 main 已有的三个 Issue 137 文档缺少 frontmatter 阻断；git show 确认基线同样缺失，本次单元和链接未报告错误。未修订无关文档。

未连接真实 IM/Provider/桌面客户端，没有原截图对应请求日志；本地证据证明代码缺陷，不能证明唯一现场原因。服务器仓库只读，无部署、服务重启、commit、push 或 PR；未改 GitHub CI、默认测试入口或 Gate。
