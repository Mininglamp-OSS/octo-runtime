---
type: Journal
title: PR 251 新 REST 合同下的有效 review 修复
description: 明确身份拒绝、未知通知取消与交互卡文字兜底的证据和边界。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T03:00:00Z
---

# PR 251 review 修复

以 64e34af6 的 Manager 生效凭据合同为基线。用户要求有效问题全部修完再统一提交，Jerry-Xin 的额外建议本轮不改；在 PR 用英文声明处置，并明确反对将断网重连时的 REST 准入绑定到 WS 验证。

三个独立缺口均有实际调用链和回归支持：unknown 通知丢失原轮取消/过期合同；明确不同 Bot 或空间准入拒绝发生在 identity.accept 前，未撤销旧投递 scope；REST 交互卡创建成功后原 WS 按钮绑定已经清理，却仍返回可交互。

应用层与传输层共同检查通知取消和过期；明确拒绝撤销旧 scope，恢复原身份也不复活；交互创建后重新检查原 run 绑定，保留卡片回执收尾并让 Runtime 发文字命令。正常断网、同身份 token 更新仍不暂停 REST；不增加凭据刷新、验证等待或按钮迁移。

验证记录见 [任务 validation](../../tasks/channel-rest-manager-credentials/validation.md)：构建/静态检查通过，596 既有渠道回归、2 CLI/SDK 恢复、18 手动专项，共 616 通过。手动专项不进入默认 CI；未安装重启或重新执行真实 Wi-Fi/Provider/IM 验收。前一提交存在独立 Codex 进程清理的 macOS Node 26 CI 失败，未扩大本次修改处理。
