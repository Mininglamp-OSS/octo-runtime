---
type: Journal
title: Issue 71 评审整改与原生 Extra 收尾合同
description: 记录依赖权限与取消分离、三个公开模块的发行验证及宿主数据库边界。
tags: [architecture, lifecycle, sdk, testing, extra]
timestamp: 2026-10-21T00:00:00Z
---

# 结果

main@70f0247 为基准，在当前功能 worktree 完成三个评审项。工程规则删除 owner 依赖代理要求；Extra close 不再因取消通知立即封锁尾部保存；主包新增 WeCom/WebUI 公开模块，与 Gateway 一同通过实际 tgz 包外验证。尚未提交或创建 PR。

# 可复用结论

停止业务准入、取消通知和依赖调用权限是三个独立动作。已有任务和 disposer 需要在共享截止内调用宿主函数完成终态保存。插件清理结束或期限到达后，检查权限及单调绝对截止，再决定是否进入宿主函数；不能只依赖 timer。撤销权限后等待全部真实操作，不能在 close 起点仅截一次集合，也不能把取消 ACK 当成终态或保存成功。

插件负责在 disposer 等待自己的消费、保存和投递；框架并发核对 Run 排空，复用 main 的 4 秒单调预算。初始化回滚和服务 close 不重开预算；未结束函数持续占额，失败或超时保留占有名称。JS 不能强停已开始的宿主函数，SQLite 创建、连接、事务、迁移和关闭始终由宿主负责。

删除接入 API 时必须验证实际发行包：workspace 导入无法发现缺少 exports、声明依赖或静态文件的问题。主包的三个 /extras/<name> 模块都应能原生构造并完成生命周期，WebUI 还需读取实际 HTML 与引用资源。

这些约束已写入[架构原则第 9、10 条](../../rules/architecture.md#统一原生服务构造与部署边界)，精确合同与验收见[整改方案](../../tasks/unified-native-sdk-services/remediation.md)。

# 证据

类型、lint、命名和格式通过；全量 Node 1362 项，1352 通过、10 跳过、0 失败，UI 35 项通过。实际 tgz 离线安装、严格公共类型、原生 Kernel/三个 Extra、WebUI 静态资源、CLI Kernel 和卸载保留 Home 检查通过。OctoSpec lint 与 git diff --check 通过，详见[实施记录](../../tasks/unified-native-sdk-services/implementation.md#评审整改验证)。本轮为实施者自查，不声称完成新的独立评审、外部 Electron 或真实 IM/Provider 验证。

# PR 第二轮整改

`134b98b` 推送 PR #74 后，Jerry-Xin 提出的初始化失败取消过晚、CLI 残留句柄不退出，以及 yujiawei 提出的 Extra 迟到 bind 漏关均由新回归复现，现已修复。初始化回滚必须在 disposer 等待前启动同一预算的取消/排空；绑定中的资源必须被跟踪，超时后仍继续迟到回收；CLI 进程最终退出只属于可执行入口，不得进入 SDK。

yujiawei 提出的 Kernel bind 取消漏关未复现：当前串行 await listen、检查取消并 catch 回滚的顺序已经覆盖该路径。确定性测试在改动前后都确认 socket 关闭、endpoint 释放且允许新实例，不改 Kernel 实现。此项与成立的 Extra 问题分别记录，不能用相似代码推定相同竞态。

本轮 50 项定向回归、1359 项 Node 测试（10 跳过）、35 项 UI 测试及类型/lint/命名/格式、实际 tgz 验证通过。新增 gate 回归纳入 Windows CI；本地证据限 macOS。验收和原始对照见[第二轮实施记录](../../tasks/unified-native-sdk-services/implementation.md#pr-第二轮评审整改验证)。
