---
type: Journal
title: Issue 93 睡眠恢复与状态日志规划
description: 记录独立 worktree、规划合同、用户补充、证据限制和文档检查结果。
tags: [architecture, lifecycle, channel, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 本轮交付

在 `origin/main@3b34415` 新建 `plan/93-sleep-wake-recovery`，路径 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-93`。桌面 worktree 工具因聊天位于多个仓库父目录返回 Not a git repository；标准 git worktree 创建成功，原 main 未修改。

完成 [简报](../../tasks/93-sleep-wake-recovery/brief.md)、源码分析、恢复设计、M0-M6 计划、A01-A27 验收和 S01-S14 双模式矩阵。规划可执行性自评95分，根因和真实验收仍有明确门槛；未实施代码、未运行真实服务、未提交或推送。

用户补充将重试调整为5/10/15/15秒，并明确 `channel-gateway logs` 仅展示 Extra 工作状态。计划规定状态 stdout 与有界文件镜像，排除聊天内容、具体会话、模型和工具输出。SDK 默认静默；CLI 自己的状态输出不能污染 worker NDJSON。

# 可复用调查结论与边界

服务 running、IPC 可达、worker ready、Provider 可用、Bot WS online、Run 完成和回复投递是不同证据。Gateway 与 Kernel 两次重启只能证明恢复跨越两个边界，不能证明 socket 监听坏了。reason12 在本地 IM 源码表示踢连接且有多种触发点，必须核实部署，不能直接无限重连。

以上已是现行架构要求，本轮不改生产规则来宣称新恢复保证已经实现。新15秒退避、首次离线后台恢复及状态日志合同在实施时更新对应规则；不把未经实测的候选心跳修复写成当前能力。

# 验证

上游 OctoSpec OKF 校验通过：296 个知识文件。context YAML 解析、11条已读规则的 SHA-256 指纹、A01-A27/S01-S14 编号完整性通过。`git diff --check` 和新增文件行尾空白检查通过；原 main checkout 保持干净。

完整仓库知识 lint 仍失败，唯一输出为 `已退出的文档目录仍存在: docs`，与干净基线一致；未出现新增 frontmatter、规则索引或本地链接错误。不删除现行 docs 目录来绕过。产品构建、测试、平台睡眠/自启、真实 IM/Provider 全部未执行。
