# adapter.codex/options

[简体中文](../../../zh-CN/reference/agent-env/codex-options.md) | [Private Item Index](private-items.md)

This is an Adapter-owned private item, not a public standard bean. Put it alongside public adapter routing and the required workspace in agentEnv.items. Combine existing options into the same payload; duplicate namespace/name pairs are invalid.

## Payload

| Field                       | Type, Omission and Behavior                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collaborationMode`         | default / plan; omission does not probe, override or reset. Explicit values must be advertised. Missing model, unsupported value or RPC rejection fails. Native settings prefer explicit model/effort, otherwise thread response. |
| `reasoningSummary`          | auto / concise / detailed / none; omission or a non-string uses auto; unknown strings fail.                                                                                                                                       |
| `sandbox`                   | read-only / workspace-write / danger-full-access; non-full_access defaults to workspace-write and rejects danger-full-access. full_access forces danger-full-access.                                                              |
| `appServerRequestTimeoutMs` | Finite positive milliseconds, default 30,000; invalid values use the default. Per-app-server-RPC deadline.                                                                                                                        |
| `finalizationTimeoutMs`     | Finite positive milliseconds, default 15,000; invalid values use the default. Controls eligible final_answer cleanup fallback, not the whole-run budget.                                                                          |

### Complete Item Example

```json
{
  "namespace": "adapter.codex",
  "name": "options",
  "payload": {
    "collaborationMode": "plan"
  }
}
```

## Boundary and Ownership

The package validates these fields on consumption, outside public Schema/generated types. Invalid-value behavior is field-specific as above; do not assume uniform ignoring or rejection. Unused unknown fields are not supported options. model/effort uses the public model item.

## Package Entry Point and Implementation

[codex README](../../../../packages/octo-runtime-adapter-codex/README.md), [Implementation](../../../../packages/octo-runtime-adapter-codex/src/).
