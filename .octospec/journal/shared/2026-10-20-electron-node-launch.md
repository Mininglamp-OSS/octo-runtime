---
type: Journal
title: Electron 宿主 Node 选择与启动回滚
description: 独立解释器选项、spawn 失败所有权修复与 Work App 实机验证。
tags: [sdk, lifecycle, integration, testing]
timestamp: 2026-10-20T00:00:00Z
---

从 main `fae6333` 接入 Work App。Electron 的 process.execPath 指向 Electron，Host SDK 新增可选绝对 nodePath，由宿主选择发行物中的 Node，初次启动与 restart 保持同一选择。没有引入 CLI、全局环境修改或业务默认。

回归发现 spawn ENOENT 时根本没有子进程，却被缺少组件清理 ACK 误判为清理失败，导致同名 Extra 永久无法替换。现区分未 spawn 与进程退出；未创建组件时仍清理临时配置，不要求不存在组件的 ACK。已经创建进程的 incomplete 约束保持不变。

验证：

- SDK 生命周期、启动回滚、依赖代理和 Kernel 客户端五组实进程测试共 34 项通过。
- Work App 全量测试 1649 项通过、1 项跳过；随后补充的订阅关闭与作用域失效测试使服务定向测试 8 项通过。
- 宿主正式模式构建与类型检查通过。
- 发行目录在临时 Home 中启动 Kernel，发现全部 12 个 Adapter，两个独立 Extra 均完成启动与关闭，Kernel PID 不变。
- Work App 连接用户指定的正式环境 https://im.deepminer.com.cn，真实本地聊天完成，24 条 CanonicalEvent 持久化，幂等及历史 UI 回显通过。
- 真实 renderer 的频道验证通过：认证失败可见、不可用 Adapter 不阻断配置载入、Gateway 编辑保留 Kernel、企业微信状态隔离、临时频道删除及原配置保留。未发送真实 IM 消息。

未执行完整 Runtime CLI/WebUI 测试和跨平台发行矩阵；此次自动化覆盖集中在 Host SDK 生命周期。用户要求的正式环境覆盖仓库默认 im-test 联调约定。
