# Inputs Reference

[简体中文](../../zh-CN/reference/input-parts.md) | [Invoke API](invoke-input.md)

inputs is an ordered ModelInputPart array with 1–128 text and image parts. client.invoke accepts the array or InvocationContent.parts; CLI JSON and client.submit use InvokeInput.inputs. [AgentEnv](agent-env-standard.md) carries execution settings separately.

## Text

### Example

```json
[{ "type": "text", "text": "Summarize the prepared project.", "id": "request" }]
```

### Payload Definition

| Field | Type | Requirement |
| --- | --- | --- |
| `type` | `"text"` | Required. |
| `text` | `string` | Required; empty strings are allowed. |
| `id` | `string` | Optional nonempty string, unique within the array. |

### Notes

Application prompts, personality, history and business material are ordinary text. Markdown or XML tags do not change trust or authorization. Runtime provides no system/developer/trusted roles and adds neither separators nor history. Each part rejects unknown fields.

## Images

### Example

```ts
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const bytes = await readFile("/absolute/prepared/screenshot.png");
const image = {
  type: "image" as const,
  mimeType: "image/png" as const,
  data: bytes.toString("base64"),
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex")
};
const inputs = [{ type: "text" as const, text: "Inspect this screenshot." }, image];
```

### Payload Definition

| Field | Type | Requirement |
| --- | --- | --- |
| `type` | `"image"` | Required. |
| `mimeType` | `"image/png" \| "image/jpeg" \| "image/webp"` | Required. |
| `data` | `string` | Required, canonical Base64 of raw image bytes. |
| `byteSize` | `number` | Required integer, 1–2,097,152 decoded bytes. |
| `sha256` | `string` | Required SHA-256 of the raw bytes, 64 lowercase hexadecimal characters. |
| `id` | `string` | Optional nonempty string, unique within the array. |

### Notes

data accepts neither paths, URLs nor data URLs. Callers obtain authorization to read images and supply their bytes; the service does not read paths embedded in text. Each input permits four images totaling 8 MiB; primary and recovery inputs are checked separately. Validation covers size, canonical Base64, hash and file signature rather than complete decoding. An Adapter without image support rejects the input.

The entire IPC request permits 32 MiB including Base64, recovery material and configuration; AgentEnv has a separate 65,536-byte budget.

## Primary and Recovery Input

### Example

```ts
const content = {
  parts: [{ type: "text" as const, text: "Continue the task." }],
  protocol_mode: "canonical" as const,
  freshFallbackModelInputParts: [
    { type: "text" as const, text: "Project context and prior results. Continue the task." }
  ]
};
const run = client.invoke(content, sessionId, providerSession, agentEnv);
```

### Payload Definition

These are InvocationContent fields. InvokeInput uses the same fields, naming parts as inputs.

| Field | Type | Usage |
| --- | --- | --- |
| `parts` | `ModelInputPart[]` | Required primary input. |
| `modelInput` | `string` | Optional nonempty complete primary text, replacing only text-only primary input; image input retains its ordered parts. |
| `freshFallbackModelInputParts` | `ModelInputPart[]` | Optional complete recovery input, preferred when supplied; retain current images and order. |
| `freshFallbackModelInput` | `string` | Optional nonempty recovery text, lower priority than recovery parts. |
| `freshFallbackImagesUnavailable` | `boolean` | Optional; true explicitly fails fresh fallback. |
| `prompt` | `string` | Optional nonempty display description, not model text. |
| `runMetadata` | `Record<string, unknown>` | Optional tracking JSON, not model text. |

### Notes

Recovery input is selected only when execution enters fresh fallback: recovery parts, then one recovery text part, then primary parts. Each recovery input includes its required prompts, history and current request. Text-only recovery that loses images is rejected. Declare unavailable when historical images cannot be recovered.

client.invoke validates and freezes input at call time and submits on first consumption. Later mutations do not affect the call. Structure, budget and integrity errors may fail before submission; Provider modality support is checked at the execution boundary. An admission ACK does not establish completion.

Sources: [input schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json), [InvocationContent](../../../packages/octo-runtime-protocol/src/invoke-input.ts), [image and recovery validation](../../../packages/octo-runtime-protocol/src/multimodal.ts).
