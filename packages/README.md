# Packages

Internal workspace packages compose the execution infrastructure and are not independently published.

| Package                                          | Responsibility                                          |
| ------------------------------------------------ | ------------------------------------------------------- |
| [Protocol](octo-runtime-protocol/README.md)      | Types, schema, wire validation                          |
| [Client](octo-runtime-client/README.md)          | Independently installable client for an existing Kernel |
| [Core](octo-runtime-executor-core/README.md)     | AgentExecutor and shared execution                      |
| [Kernel](octo-runtime-executor-kernel/README.md) | RPC, admission, observation and lifecycle               |
| [Host](octo-runtime-host-sdk/README.md)          | Home, identity and endpoint conventions                 |

Provider adapters integrate Harness frameworks. Runtime and client are separate self-contained npm distributions. Channels belong to [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)。

## Developer Reference

Package READMEs describe responsibilities, imports and lifecycle. Public fields and payloads are maintained in docs. Adapter-owned private settings link from their package README to the dedicated reference.

- [inputs: Text, Images and Recovery](../docs/en/reference/input-parts.md)
- [Invoke API](../docs/en/reference/invoke-input.md)
- [AgentEnv: Seven Standard Items and Composition](../docs/en/reference/agent-env-standard.md)
- [Adapter Private AgentEnv Fields](../docs/en/reference/agent-env/private-items.md)

## Provider Adapters

| Package | Responsibility |
| --- | --- |
| [Adapter SDK](octo-runtime-adapter-sdk/README.md) | Adapter authoring and shared helpers |
| [codex](octo-runtime-adapter-codex/README.md) | Provider integration, construction, private configuration and limits |
| [claude-code](octo-runtime-adapter-claude-code/README.md) | Provider integration, construction, private configuration and limits |
| [dsh](octo-runtime-adapter-dsh/README.md) | Provider integration, construction, private configuration and limits |
| [acp](octo-runtime-adapter-acp/README.md) | Provider integration, construction, private configuration and limits |
| [hermes](octo-runtime-adapter-hermes/README.md) | Provider integration, construction, private configuration and limits |
| [kimi-code](octo-runtime-adapter-kimi-code/README.md) | Provider integration, construction, private configuration and limits |
| [mcode](octo-runtime-adapter-mcode/README.md) | Provider integration, construction, private configuration and limits |
| [qodercli](octo-runtime-adapter-qodercli/README.md) | Provider integration, construction, private configuration and limits |
| [qoderclicn](octo-runtime-adapter-qoderclicn/README.md) | Provider integration, construction, private configuration and limits |
| [opencode](octo-runtime-adapter-opencode/README.md) | Provider integration, construction, private configuration and limits |
| [codebuddy](octo-runtime-adapter-codebuddy/README.md) | Provider integration, construction, private configuration and limits |
| [openclaw](octo-runtime-adapter-openclaw/README.md) | Provider integration, construction, private configuration and limits |
| [antigravity](octo-runtime-adapter-antigravity/README.md) | Provider integration, construction, private configuration and limits |
| [grok-build](octo-runtime-adapter-grok-build/README.md) | Provider integration, construction, private configuration and limits |
