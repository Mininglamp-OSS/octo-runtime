---
type: Task
title: Electron 宿主显式选择 Node
description: 为 owned Kernel 和 Extra 提供独立 Node 路径，保持通用组件边界。
tags: [sdk, lifecycle, integration]
timestamp: 2026-10-20T00:00:00Z
---

Electron 的 process.execPath 是 Electron，不能作为普通 Node 启动 Kernel/Extra。
宿主决定并准备可执行程序，SDK 只执行显式 nodePath；省略时保持 Node 宿主行为。
不修改全局环境、不调用 CLI、不增加业务默认或改变其他宿主的行为。
nodePath 必须绝对，初启与 restart 使用同一选择，worker 继承真正 Node。
验收覆盖指定路径失败回滚、正常启动/重启、Extra 独立停止和宿主实机启动。
