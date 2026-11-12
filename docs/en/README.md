# Octo Runtime Developer Documentation

[简体中文](../zh-CN/README.md)

Runtime is an embeddable Agent execution layer. Callers prepare input and execution configuration; Runtime invokes Providers and returns an event stream.

## Getting Started

- [SDK Integration](getting-started/sdk.md): connect to Kernel or create an embedded execution service.
- [CLI Installation and Operations](getting-started/cli.md): install, start, inspect and stop a local service.
- [Harness Setup](guides/harnesses.md): prepare Provider programs and accounts.
- [Architecture](concepts/architecture.md): module responsibilities and application boundaries.

## Developer Reference

| Topic | Page |
| --- | --- |
| Text, images, primary and recovery input | [Inputs](reference/input-parts.md) |
| Invocation parameters, output mode and ProviderSession | [Invoke API](reference/invoke-input.md) |
| Envelope and seven standard execution items | [AgentEnv Standard Reference](reference/agent-env-standard.md) |
| Adapter fields; modeId is a work-mode ID | [AgentEnv Private Items](reference/agent-env/private-items.md) |
| SDK methods, results and invocation registry | [KernelClient](reference/kernel-client.md) |
| JSON-RPC, identity, replay and transport limits | [Kernel IPC](reference/kernel-ipc.md) |
| Events, frames, cancellation and interaction payloads | [Output and Control](reference/output-and-control.md) |
| Adapter support | [Providers](reference/providers.md) |
| Service directory and path constraints | [Runtime Home](reference/runtime-home.md) |
| Session, invocation and Provider identities | [Identifiers](concepts/identifiers.md) |

## Guides

| Task | Page |
| --- | --- |
| Separate business input and execution settings | [Inputs and AgentEnv](concepts/inputs-and-contexts.md) |
| Prepare context and continue sessions | [Environment and Sessions](guides/context-and-sessions.md) |
| Consume and control executions | [AgentRun](guides/agent-runs.md) |
| Connect MCP servers | [MCP](guides/mcp.md) |
| Handle startup failures | [Startup Diagnostics](guides/startup-diagnostics.md) |
| Diagnose execution failures | [Troubleshooting](guides/troubleshooting.md) |
| Integrate business channels | [Independent Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) |

Contributors can read [Documentation Maintenance](maintenance.md).
