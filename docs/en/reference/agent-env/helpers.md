# AgentEnv Helper APIs

[简体中文](../../../zh-CN/reference/agent-env/helpers.md) | [AgentEnv Standard Reference](../agent-env-standard.md)

This supplementary API reference covers constructing, reading and merging AgentEnv in source SDK integrations. Pass a complete prepared envelope to invoke; call these helpers explicitly when needed.

## Construct and Replace

### Example

```ts
import { defaultAgentEnv, withAgentEnvItems } from "@mininglamp-oss/octo-runtime-adapter-sdk";

const agentEnv = withAgentEnvItems(defaultAgentEnv("codex"), [
  {
    namespace: "octo.execution",
    name: "workspace",
    payload: { path: "/absolute/prepared/project" }
  }
]);
```

### Parameters and Results

Import these APIs from `@mininglamp-oss/octo-runtime-adapter-sdk`.

| API | Parameters and result |
| --- | --- |
| `defaultAgentEnv(type)` | Adapter type string; returns an independent AgentEnv containing Adapter, ask approval and a 24-hour whole-run budget. |
| `withAgentEnvItems(env, items)` | AgentEnv or undefined plus ContextItem[]; replaces matching items whole, preserves other order and appends new items; returns an independent AgentEnv. |
| `withAgentEnvDefaults(submitted, defaults)` | Two complete AgentEnv envelopes; fills only items missing from the first using the second; returns an independent AgentEnv. |

### Notes

These functions neither prepare a workdir nor select a model. Replacement and filling match namespace/name; retaining an item does not merge its payload. Duplicate keys within an input envelope are rejected. The consuming Adapter still validates semantics.

## Read Items

### Example

```ts
import { agentEnvItem } from "@mininglamp-oss/octo-runtime-adapter-sdk";

const workspace = agentEnvItem<{ path: string }>(agentEnv, "octo.execution", "workspace");
```

### Parameters and Results

Import these APIs from Adapter SDK.

| API | Parameters and result |
| --- | --- |
| `agentEnvItem<T>(env, namespace, name)` | Exact match returning the original payload reference or undefined; T supplies static hints only. |
| `invocationModel(request)` | Takes InvokeRequest; returns selection.id or undefined. |
| `invocationEffort(request)` | Returns reasoning.effort or undefined. |
| `invocationWorkdir(request)` | Returns workspace.path or "" when absent. |
| `invocationApprovalMode(request)` | Returns and validates approval mode, using ask when omitted. |

### Notes

Treat returned payloads as read-only. Generics perform no runtime validation; the Adapter owns required-field checks, validation and Provider mapping. Model, effort and workdir readers do not establish application or resource availability.

## Merge Envelopes

### Example

```ts
import { mergeContext } from "@mininglamp-oss/octo-runtime-protocol";

const merged = mergeContext(
  {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "envs", payload: {
        env_variables: [{ key: "PROJECT_ID", value: "base" }]
      } }
    ]
  },
  {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "envs", payload: {
        env_variables: [{ key: "PROJECT_ID", value: "selected" }, { key: "REGION", value: "eu" }]
      } }
    ]
  }
);
```

The resulting PROJECT_ID is selected, with REGION=eu retained.

### Parameters and Results

Import `mergeContext(defaults, overrides)` from the source protocol package. Both arguments are complete AgentEnv envelopes; the result is an independent merged envelope. Parameter names describe the inputs to this function call.

| Item | Matching-item behavior |
| --- | --- |
| model | Merge selection/reasoning at the first payload level; replace nested objects whole. |
| limits | Override individual budget fields. |
| envs | Merge by env_variables key. |
| mcp | Merge by server name; replace matching servers whole. |
| adapter, workspace, approval_policy, private items | Replace the whole item. |

### Notes

The second argument overrides the first. Omissions or empty lists/maps do not clear the first argument's items; edit input envelopes before merging when needed. Matching MCP servers do not deeply merge headers/env. Merging grants no permissions or proof of Provider support.

## resolveContextConfiguration

### Parameters and Results

The source protocol package also provides `resolveContextConfiguration(configuration, request)`, returning an independent AgentEnv.

| Parameter | Definition |
| --- | --- |
| `configuration` | This function's object containing required defaults and mandatory, each a complete AgentEnv permitting empty items. |
| `request` | A complete AgentEnv. |

It merges configuration.defaults with request, then applies configuration.mandatory using the matching-item behavior above. defaults and mandatory are parameter fields of this helper, rather than AgentEnv fields or execution-time configuration layers.

### Notes

This processing occurs only when the function is explicitly called. invoke consumes the resulting AgentEnv without automatically calling the helper. Conflicting values are overwritten in order rather than reported as configuration conflicts.

Sources: [Adapter SDK](../../../../packages/octo-runtime-adapter-sdk/src/agent-env.ts), [mergeContext](../../../../packages/octo-runtime-protocol/src/context.ts), [resolveContextConfiguration](../../../../packages/octo-runtime-protocol/src/context-configuration.ts).
