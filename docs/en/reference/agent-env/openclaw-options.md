# adapter.openclaw/options

[简体中文](../../../zh-CN/reference/agent-env/openclaw-options.md) | [Private Item Index](private-items.md)

This is an OpenClaw-owned private item, not a public standard bean. Put it alongside public adapter routing in agentEnv.items. Combine existing options into the same payload; duplicate namespace/name pairs are invalid. OpenClaw uses the Provider workspace and requires no local workspace.

## Payload

| Field            | Type, Omission and Behavior                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`        | Optional string matching `^[a-z0-9_][a-z0-9_-]{0,63}$`; omission or null selects main. Empty/invalid values fail. Target must exist; resumed session-key prefix and receipt agentId must match or OPENCLAW_SESSION_AGENT_MISMATCH is returned. |
| `timeoutSeconds` | Optional finite positive number in seconds; invalid values fail. Omission uses a 30-minute local wait budget without sending native timeout. Explicit native timeout is floored. Separate from the public watchdog.                          |

### Complete Item Example

```json
{
  "namespace": "adapter.openclaw",
  "name": "options",
  "payload": {
    "agentId": "main"
  }
}
```

## Boundary and Ownership

The package validates these fields on consumption, outside public Schema/generated types. Invalid-value behavior is field-specific as above; do not assume uniform ignoring or rejection. Unused unknown fields are not supported options. model/effort uses the public model item.

Gateway URL, token and device identity travel in trusted local context, outside the envelope. This Adapter rejects non-empty invocation envs and MCP, uses a Provider workspace and does not encode images.

## Package Entry Point and Implementation

[openclaw README](../../../../packages/octo-runtime-adapter-openclaw/README.md), [Implementation](../../../../packages/octo-runtime-adapter-openclaw/src/).
