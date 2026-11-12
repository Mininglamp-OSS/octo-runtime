# adapter.dsh/options

[简体中文](../../../zh-CN/reference/agent-env/dsh-options.md) | [Private Item Index](private-items.md)

This is an Adapter-owned private item, not a public standard bean. Put it alongside public adapter routing and the required workspace in agentEnv.items. Combine existing options into the same payload; duplicate namespace/name pairs are invalid.

## Payload

| Field                          | Type, Omission and Behavior                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dshBin`                       | Required existing absolute npm JS entrypoint selected by the host (.js/.mjs/.cjs). Desktop/ASAR, cmd shims and relative paths fail. Trusted host providerOptions may override it and must match probing. |
| `dshHome`                      | Optional string setting this invocation's DSH_HOME.                                                                                                                                                      |
| `profile`                      | Optional string, default sdk.                                                                                                                                                                            |
| `provider`                     | Optional string, default deepseek-account.                                                                                                                                                               |
| `initializeTimeoutMs`          | Integer or digit-only string in 1–86,400,000; default 15,000 milliseconds.                                                                                                                               |
| `requestTimeoutMs`             | Same range, default 30,000 milliseconds.                                                                                                                                                                 |
| `shutdownTimeoutMs`            | Same range, default 1,000 milliseconds.                                                                                                                                                                  |
| `maxTokens`                    | Optional integer or digit-only string in 1–86,400,000; omitted values are not sent.                                                                                                                      |
| `sandbox`                      | Omitted or danger-full-access only; public approval_policy must be full_access.                                                                                                                          |

### Complete Item Example

```json
{
  "namespace": "adapter.dsh",
  "name": "options",
  "payload": {
    "dshBin": "/absolute/installed/dsh/lib/bin.js"
  }
}
```

## Boundary and Ownership

The package validates these fields on consumption, outside public Schema/generated types. Invalid-value behavior is field-specific as above; do not assume uniform ignoring or rejection. Unused unknown fields are not supported options. model/effort uses the public model item.

DSH string options must contain non-whitespace content, no NUL and at most 4096 characters; original values are passed through. The external Provider must pass the package minimum-version check. The default deepseek-flash model is Adapter initialization behavior. Official SDK support is experimental; see package notes for cleanup and memory limits.

## Package Entry Point and Implementation

[dsh README](../../../../packages/octo-runtime-adapter-dsh/README.md), [Implementation](../../../../packages/octo-runtime-adapter-dsh/src/).
