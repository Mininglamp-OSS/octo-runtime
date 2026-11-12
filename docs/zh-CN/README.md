# Octo Runtime 开发文档

[English](../en/README.md)

Runtime 是可嵌入应用的 Agent 执行底座。调用方准备输入与执行配置，Runtime 调用 Provider 并返回事件流。

## 入门

- [SDK 接入](getting-started/sdk.md)：应用连接 Kernel 或原生创建执行服务。
- [CLI 安装与运维](getting-started/cli.md)：安装、启动、检查和停止本地服务。
- [Harness 安装配置](guides/harnesses.md)：准备 Provider 程序与账号。
- [架构](concepts/architecture.md)：模块职责与应用边界。

## 开发参考

| 主题 | 页面 |
| --- | --- |
| 文本、图片、主输入与恢复输入 | [Inputs](reference/input-parts.md) |
| 调用参数、输出模式与 ProviderSession | [Invoke API](reference/invoke-input.md) |
| 信封与七个标准执行项 | [AgentEnv 标准参考](reference/agent-env-standard.md) |
| Adapter 专属字段；modeId 为工作模式 ID | [AgentEnv 私有项](reference/agent-env/private-items.md) |
| SDK 方法、返回值与调用登记 | [KernelClient](reference/kernel-client.md) |
| JSON-RPC、身份、续流与传输限制 | [Kernel IPC](reference/kernel-ipc.md) |
| 事件、帧、取消与交互 payload | [输出与控制](reference/output-and-control.md) |
| Adapter 支持范围 | [Provider](reference/providers.md) |
| 服务目录与路径限制 | [Runtime Home](reference/runtime-home.md) |
| 会话、调用和 Provider 身份 | [标识](concepts/identifiers.md) |

## 使用指南

| 任务 | 页面 |
| --- | --- |
| 区分业务输入与执行配置 | [Inputs 与 AgentEnv](concepts/inputs-and-contexts.md) |
| 准备背景和续接会话 | [执行环境与会话](guides/context-and-sessions.md) |
| 消费与控制执行 | [AgentRun](guides/agent-runs.md) |
| 连接 MCP server | [MCP](guides/mcp.md) |
| 处理启动失败 | [启动诊断](guides/startup-diagnostics.md) |
| 排查执行失败 | [故障排查](guides/troubleshooting.md) |
| 接入业务渠道 | [独立 Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) |

文档贡献者见[文档维护](maintenance.md)。
