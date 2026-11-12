# ACP modeId

[简体中文](../../../zh-CN/reference/agent-env/acp-options.md) | [Private Item Index](private-items.md)

Shared ACP implementations use each Adapter's own private options item, substituting its actual type in the namespace. This is not a public standard item. Grok Build has a different setter contract; see its dedicated page.

**modeId is a Provider work-mode ID, not a model ID. Model IDs use octo.execution/model.payload.selection.id. These are validated and set independently, without inferring one from the other.**

## Applicable Items

| Item                         | Package Entry                                                                |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `adapter.acp/options`        | [acp](../../../../packages/octo-runtime-adapter-acp/README.md)               |
| `adapter.hermes/options`     | [hermes](../../../../packages/octo-runtime-adapter-hermes/README.md)         |
| `adapter.kimi-code/options`  | [kimi-code](../../../../packages/octo-runtime-adapter-kimi-code/README.md)   |
| `adapter.mcode/options`      | [mcode](../../../../packages/octo-runtime-adapter-mcode/README.md)           |
| `adapter.qodercli/options`   | [qodercli](../../../../packages/octo-runtime-adapter-qodercli/README.md)     |
| `adapter.qoderclicn/options` | [qoderclicn](../../../../packages/octo-runtime-adapter-qoderclicn/README.md) |
| `adapter.opencode/options`   | [opencode](../../../../packages/octo-runtime-adapter-opencode/README.md)     |

## Payload

Optional modeId must be a non-empty, non-whitespace string matching this session's native advertisement exactly. No trimming or default-to-build translation occurs. Omission does not probe/set a mode or reset a resumed session.

```json
{
  "namespace": "adapter.hermes",
  "name": "options",
  "payload": { "modeId": "plan" }
}
```

plan illustrates the shape, not guaranteed Provider support. Combine options in one payload rather than repeating the item.

### Advertisement and Setter

Prefer the mode config option, including grouped options, and its real configId; otherwise use modes.availableModes. Missing advertisement, unsupported values, missing configId and RPC rejection fail without substituting another mode. Matching current values need no setter; otherwise call session/set_config_option or session/set_mode. Setter success proves acceptance, not fabricated application evidence.

### OpenCode

Only ask uses ACP and supports modeId. full_access uses JSON CLI and rejects explicit modeId before launch with OPENCODE_MODE_UNSUPPORTED. This does not switch approval policy or transport. assisted is unsupported.

## Boundary and Sources

modeId does not change approval_policy; model/effort remains in the public model item. Private parameters are outside public Schema. CodeBuddy does not consume the shared ACP modeId helper, so ACP transport alone does not establish support. Antigravity also has no private mode item documented here.

[ACP implementation](../../../../packages/octo-runtime-adapter-acp/src/index.ts), [OpenCode implementation](../../../../packages/octo-runtime-adapter-opencode/src/index.ts), [Grok Build](grok-build-options.md).
