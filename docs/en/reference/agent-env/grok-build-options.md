# adapter.grok-build/options

[简体中文](../../../zh-CN/reference/agent-env/grok-build-options.md) | [Private Item Index](private-items.md)

This is an Adapter-owned private item, not a public standard bean. Put it alongside public adapter routing and the required workspace in agentEnv.items. Combine existing options into the same payload; duplicate namespace/name pairs are invalid.

**modeId is a Provider work-mode ID, not a model ID. Model IDs use octo.execution/model.payload.selection.id. These are validated and set independently, without inferring one from the other.**

## Payload

| Field     | Type, Omission and Behavior                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modeId`  | Only default / plan; omission sends no setter and does not reset. Explicit values use session/set_mode without requiring ACP modes advertisement. Invalid values or setter failures fail without fallback; approval/yoloMode and exit_plan_mode remain separate. |
| `sandbox` | Explicit per-invocation sandbox is rejected with SANDBOX_UNSUPPORTED.                                                                                                                                                                                            |

### Complete Item Example

```json
{
  "namespace": "adapter.grok-build",
  "name": "options",
  "payload": {
    "modeId": "plan"
  }
}
```

## Boundary and Ownership

The package validates these fields on consumption, outside public Schema/generated types. Invalid-value behavior is field-specific as above; do not assume uniform ignoring or rejection. Unused unknown fields are not supported options. model/effort uses the public model item.

## Package Entry Point and Implementation

[grok-build README](../../../../packages/octo-runtime-adapter-grok-build/README.md), [Implementation](../../../../packages/octo-runtime-adapter-grok-build/src/).
