# Host SDK

[English](README.md) | [包导航](../README.zh.md)

提供 Home、身份、endpoint 与启动诊断辅助 API。原生宿主从源码 workspace 依赖本包；服务与 Provider 对象由宿主按明确所有权维护。

本包不管理业务渠道、历史与投递。独立应用通过 runtime-client 连接已有 Kernel。

## 开发参考

- [SDK 接入](../../docs/zh-CN/getting-started/sdk.md)。
- [Runtime Home](../../docs/zh-CN/reference/runtime-home.md)。
- [启动诊断](../../docs/zh-CN/guides/startup-diagnostics.md)。
- [应用与 Runtime 职责](../../docs/zh-CN/concepts/architecture.md)。
