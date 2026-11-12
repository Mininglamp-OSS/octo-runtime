# Runtime Public Protocol

[简体中文](README.zh.md) | [Packages](../README.md)

This private workspace package owns schemas, TypeScript types and runtime validators for input, AgentEnv, output events and IPC. Runtime and source hosts use it directly; standalone applications import the public protocol through `@mininglamp-oss/octo-runtime-client/protocol`.

## Minimal Usage

```ts
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});
```

InvokeInput.check validates structure and capacity, throwing on failure without executing a call. Each Adapter validates the semantics of configuration it consumes.

## Developer Reference

| Topic | Authoritative reference |
| --- | --- |
| Text, images and recovery input | [Inputs](../../docs/en/reference/input-parts.md) |
| Invocation parameters and ProviderSession | [Invoke API](../../docs/en/reference/invoke-input.md) |
| Seven standard execution items | [AgentEnv Standard Reference](../../docs/en/reference/agent-env-standard.md) |
| Frames, events and interaction payloads | [Output and Control](../../docs/en/reference/output-and-control.md) |
| SDK methods and IPC | [KernelClient](../../docs/en/reference/kernel-client.md), [Kernel IPC](../../docs/en/reference/kernel-ipc.md) |

## Schema Maintenance

[protocol.schema.json](schema/protocol.schema.json) defines shared data; [kernel-ipc.schema.json](schema/kernel-ipc.schema.json) defines IPC requests and results. [gen-types.mjs](scripts/gen-types.mjs) generates types; do not edit generated files manually.

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

[test/fixtures](test/fixtures) holds conformance samples separately from definitions. Only IPC samples are published through the client's /protocol/ipc-fixtures.json. Runtime validators maintain byte, depth, uniqueness and execution-state semantics beyond standard Draft-07 checks. Generated types do not replace input validation.

Implementation: [InvokeInput](src/invoke-input.ts), [events and validation](src/index.ts), [frame validation](src/run-protocol.ts).
