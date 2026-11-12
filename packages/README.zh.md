# 包目录

执行基础设施由以下 workspace 包组成，内部包不单独发布。

| Package                                          | Responsibility                                          |
| ------------------------------------------------ | ------------------------------------------------------- |
| [Protocol](octo-runtime-protocol/README.zh.md)      | Types, schema, wire validation                          |
| [Client](octo-runtime-client/README.md)          | Independently installable client for an existing Kernel |
| [Core](octo-runtime-executor-core/README.zh.md)     | AgentExecutor and shared execution                      |
| [Kernel](octo-runtime-executor-kernel/README.zh.md) | RPC, admission, observation and lifecycle               |
| [Host](octo-runtime-host-sdk/README.zh.md)          | Home, identity and endpoint conventions                 |

Provider Adapter 负责适配 Harness。完整 Runtime 和独立 client 是两个自包含 npm 发行包。业务渠道迁至 [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)。

## 开发参考

包 README 说明职责、导入与生命周期；公共字段及 payload 在 docs 统一维护。Adapter 私有配置由对应包维护，README 链接专属参考页。

- [inputs：文本、图片与恢复输入](../docs/zh-CN/reference/input-parts.md)
- [Invoke API](../docs/zh-CN/reference/invoke-input.md)
- [AgentEnv：七个标准项与辅助 API](../docs/zh-CN/reference/agent-env-standard.md)
- [Adapter 私有 AgentEnv 字段](../docs/zh-CN/reference/agent-env/private-items.md)

## Provider Adapters

| Package | 职责 |
| --- | --- |
| [Adapter SDK](octo-runtime-adapter-sdk/README.zh.md) | Adapter 编写与公共 helper |
| [codex](octo-runtime-adapter-codex/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [claude-code](octo-runtime-adapter-claude-code/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [dsh](octo-runtime-adapter-dsh/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [acp](octo-runtime-adapter-acp/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [hermes](octo-runtime-adapter-hermes/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [kimi-code](octo-runtime-adapter-kimi-code/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [mcode](octo-runtime-adapter-mcode/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [qodercli](octo-runtime-adapter-qodercli/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [qoderclicn](octo-runtime-adapter-qoderclicn/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [opencode](octo-runtime-adapter-opencode/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [codebuddy](octo-runtime-adapter-codebuddy/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [openclaw](octo-runtime-adapter-openclaw/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [antigravity](octo-runtime-adapter-antigravity/README.zh.md) | Provider 接入、构造、专属配置与限制 |
| [grok-build](octo-runtime-adapter-grok-build/README.zh.md) | Provider 接入、构造、专属配置与限制 |
