# Adapter Private Items

[简体中文](../../../zh-CN/reference/agent-env/private-items.md) | [AgentEnv Standard Reference](../agent-env-standard.md)

Private items belong to the caller and consuming Adapter, outside the seven public standard items. The public layer validates only the envelope; Core forwards items in order. Unrelated Adapters may ignore unknown items. Passing structural validation does not prove consumption.

## Definition and Access

A private item still contains only namespace, name and payload. The Adapter reads it using `agentEnvItem<T>(request.agentEnv, namespace, name)`; absence returns undefined. T is a static hint, not runtime validation. The helper returns the original payload reference for read-only use. The Adapter owns fields, defaults, semantics and native mapping.

Private names require no public Schema, catalog, generated type or protocol version change. `adapter.xxx/options` is a convention used by some built-in implementations, not a public namespace standard. Do not add Provider-specific fields to public adapter/model payloads.

## Private Contract Entry Points

| Adapter        | Authoritative Fields and Examples                                                 |
| -------------- | --------------------------------------------------------------------------------- |
| Codex          | [Package README](../../../../packages/octo-runtime-adapter-codex/README.md)       |
| Claude Code    | [Package README](../../../../packages/octo-runtime-adapter-claude-code/README.md) |
| OpenClaw       | [Package README](../../../../packages/octo-runtime-adapter-openclaw/README.md)    |
| OpenCode       | [Package README](../../../../packages/octo-runtime-adapter-opencode/README.md)    |
| Other Adapters | [Package index](../../../../packages/README.md) and the matching Adapter README   |

This index connects public configuration to package-owned private references. See [SDK Integration](../../getting-started/sdk.md) for host construction and Adapter consumption. Trusted connection credentials travel through local host context without being written back to the caller envelope.

## Business Material Boundary

The caller prepares personality, application prompts, history, resource addresses and business formats as inputs. Unknown items do not automatically enter model text, fetch resources or merge history. Endpoint selection, device scheduling and failover belong to the caller, outside Runtime public execution items.

## Private Field References

| Item                                           | Detailed Reference                                   |
| ---------------------------------------------- | ---------------------------------------------------- |
| `adapter.codex/options`                        | [codex](codex-options.md)                            |
| `adapter.claude-code/options`                  | [claude-code](claude-code-options.md)                |
| `adapter.grok-build/options`                   | [grok-build](grok-build-options.md)                  |
| `adapter.openclaw/options`                     | [openclaw](openclaw-options.md)                      |
| `adapter.dsh/options`                          | [dsh](dsh-options.md)                                |
| ACP / Hermes / Kimi / MCode / Qoder / OpenCode | [modeId: Work-Mode ID, Not Model ID](acp-options.md) |

These pages are maintained by the owning packages, whose READMEs remain the contract entrypoints. This directory does not promote private fields to public protocol.
