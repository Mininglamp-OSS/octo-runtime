# Inputs 参考

[English](../../en/reference/input-parts.md) | [Invoke API](invoke-input.md)

inputs 为有序的 ModelInputPart 数组，1–128 项，支持文本与图片混排。client.invoke 接受数组，或使用 InvocationContent.parts；CLI JSON 和 client.submit 使用 InvokeInput.inputs。执行配置单独放在 [AgentEnv](agent-env-standard.md)。

## 文本

### 示例

```json
[{ "type": "text", "text": "Summarize the prepared project.", "id": "request" }]
```

### Payload 定义

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `type` | `"text"` | 必填。 |
| `text` | `string` | 必填，允许空字符串。 |
| `id` | `string` | 可选非空字符串，同一数组内唯一。 |

### 注意事项

应用提示词、人格、历史与业务材料均是普通文本。Markdown 或 XML 标签不改变信任级别与授权。Runtime 不提供 system/developer/受信角色，不添加分隔符或补历史。每个 part 拒绝未知字段。

## 图片

### 示例

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

### Payload 定义

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `type` | `"image"` | 必填。 |
| `mimeType` | `"image/png" \| "image/jpeg" \| "image/webp"` | 必填。 |
| `data` | `string` | 必填，原始图片字节的规范 Base64。 |
| `byteSize` | `number` | 必填整数，解码后 1–2,097,152 字节。 |
| `sha256` | `string` | 必填，原始字节 SHA-256，64 位小写十六进制。 |
| `id` | `string` | 可选非空字符串，同一数组内唯一。 |

### 注意事项

data 不接受路径、URL 或 data URL。调用方先取得读取图片的授权并准备字节；服务不自动读取正文里的路径。每份输入最多 4 张、合计 8 MiB；主输入与恢复输入分别校验。Runtime 将 Base64 解码为字节，校验字节数、规范 Base64、SHA-256 及对应 MIME 的文件签名；不执行完整的图片解码，也不保证图片可正常渲染。所选 Adapter 不支持图片时明确拒绝。

整个 IPC 请求最多 32 MiB，Base64、恢复材料和配置均计入；AgentEnv 另受 65,536 字节预算限制。

## 主输入与恢复输入

### 示例

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

### Payload 定义

以下是 InvocationContent 字段；InvokeInput 使用相同字段，仅将 parts 命名为 inputs。

| 字段 | 类型 | 使用方式 |
| --- | --- | --- |
| `parts` | `ModelInputPart[]` | 必填主输入。 |
| `modelInput` | `string` | 可选非空完整主正文，仅替换纯文本主输入；含图片时保留原有序 parts。 |
| `freshFallbackModelInputParts` | `ModelInputPart[]` | 可选完整恢复输入，优先使用，须保留当前图片及顺序。 |
| `freshFallbackModelInput` | `string` | 可选非空完整恢复文本，优先级低于恢复 parts。 |
| `freshFallbackImagesUnavailable` | `boolean` | 可选；true 时进入 fresh fallback 明确失败。 |
| `prompt` | `string` | 可选非空展示说明，不替代模型正文。 |
| `runMetadata` | `Record<string, unknown>` | 可选追踪 JSON，不进入模型正文。 |

### 注意事项

只有执行进入 fresh fallback 时才选择恢复输入，顺序为恢复 parts、单个恢复文本 part、主输入 parts。每份恢复输入自行包含所需提示词、历史和当前请求；会丢图的纯文本恢复拒绝。无法恢复历史图片时声明 unavailable。

client.invoke 在调用时验证并冻结输入，首次消费才提交。后续修改原对象不影响调用。结构、预算和完整性错误可以在提交前失败，Provider 模态支持在执行边界检查；受理 ACK 不表示执行完成。

来源：[输入 Schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json)、[InvocationContent](../../../packages/octo-runtime-protocol/src/invoke-input.ts)、[图片与恢复校验](../../../packages/octo-runtime-protocol/src/multimodal.ts)。
