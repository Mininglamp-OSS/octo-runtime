---
type: Journal
title: 网络恢复修复双轴审查与本地安装
description: Standards 与 Spec 独立审查，各发现一项 P2，修复复核并安装。
tags: [channel, delivery, lifecycle, testing, review]
timestamp: 2026-10-30T00:00:00Z
---

# 网络恢复修复双轴审查与本地安装

用户显式调用 code-review 并要求 build/install -g local。审查基线固定为 8b239e47231deed4c135b9b5add816484d17bb7f，范围为该基线到当前工作区的未提交修改；没有新增提交，使用 git diff 基线检查工作区，不以空的三点提交差异代替实际修改。需求来源为 channel-immediate-reconnect、channel-reconnect-final-delivery、channel-rest-card-lifetime 三个任务说明及本轮用户指示。预存 .workbuddy/ 不属于本次修改。仓库缺少技能的 docs/agents/issue-tracker.md，已提示可运行 /setup-matt-pocock-skills；本次直接采用已具备的本地需求来源。

## Standards

独立审查发现 1 项 P2：按消息创建的新投递器保存了卡片/文件回执，但 cardDeliveries 只读取连接旧投递器，违反 stateless-execution.md 的当前保留回执总数合同。修复为 Bot 生命周期持有一个专用有界投递器，所有重连 transport 共用；状态直接读取 owner.dispatcher，鉴权/注册尚未完成时也不会归零。每个投递器仍最多 512 条，文本与卡片数量分开。真实 Runtime 重连测试及文件测试断言回执计数，新 transport start 前断言保留旧计数。审查者复核后剩余 0 项。

## Spec

独立审查发现 1 项 P2：普通终态回复分支丢失 finalOptions.signal，空回复/失败/取消提示等待重连时收到 /stop 后仍可继续发送。违反原任务取消期限要求。ImInboundMessage.reply 增加兼容的可选投递参数，Runtime 透传 signal/obsolete，transport 合并 Bot 与该轮信号并在等待前后检查过期；原普通提示不进入产物/mention 准备。新增真实 Runtime 的 /stop 和 /reset 回归，确认只发控制确认、不发旧空终态提示且仅 invoke 一次。审查者复核后剩余 0 项。

## 验证与安装

最终代码全量 build、根 TypeScript noEmit、修改文件 Prettier、git diff --check 通过；本轮 lint 通过。六组相关测试共 188 项全部通过，日志 /tmp/octo-runtime-review-tests.log。workflow、脚本、根 package.json 和 pnpm-workspace.yaml 无 diff；未扩大 CI、未创建 Git 提交。

pack-release 在产出 tgz 后仍因 npm 12 JSON 返回形状报错。独立核验 68 个依赖及传递依赖、bundleDependencies、四个 Gateway JS 及 build-info 后，用离线 npm install -g 安装成功。安装前 6 个 Bot 均空闲，沿用此前重启授权停止 Gateway/Kernel，安装后先启动 Kernel 再启动 Gateway。

构建时间 2026-10-29T17:40:42.647Z（北京时间 01:40:42），来源 8b239e47231d dirty。Kernel PID 26102、Worker PID 26106 ready，Gateway PID 26735；6 个 Bot 全部 online/error=null，kernel_available=true。已安装 JS 和 build-info 与审查后构建逐字节一致。没有代发消息或主动切网；真实切网复测仍由用户执行。

结论：Standards 1 项 P2 已修复，Spec 1 项 P2 已修复；两个方向最终剩余均为 0。
