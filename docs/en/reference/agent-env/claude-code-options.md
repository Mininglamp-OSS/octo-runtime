# adapter.claude-code/options

[简体中文](../../../zh-CN/reference/agent-env/claude-code-options.md) | [Private Item Index](private-items.md)

This is an Adapter-owned private item, not a public standard bean. Put it alongside public adapter routing and the required workspace in agentEnv.items. Combine existing options into the same payload; duplicate namespace/name pairs are invalid.

## Payload

| Field            | Type, Omission and Behavior                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissionMode` | Only plan; null, default and other values fail. Omission maps ask → default, assisted → auto, full_access → bypassPermissions. Explicit plan takes precedence and suppresses --dangerously-skip-permissions even with full_access, without changing interaction authorization. Unconfirmed native init yields diagnostics rather than fabricated mode evidence. |

### Complete Item Example

```json
{
  "namespace": "adapter.claude-code",
  "name": "options",
  "payload": {
    "permissionMode": "plan"
  }
}
```

## Boundary and Ownership

The package validates these fields on consumption, outside public Schema/generated types. Invalid-value behavior is field-specific as above; do not assume uniform ignoring or rejection. Unused unknown fields are not supported options. model/effort uses the public model item.

## Package Entry Point and Implementation

[claude-code README](../../../../packages/octo-runtime-adapter-claude-code/README.md), [Implementation](../../../../packages/octo-runtime-adapter-claude-code/src/).
