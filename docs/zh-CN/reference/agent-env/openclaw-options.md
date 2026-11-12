# adapter.openclaw/options

[English](../../../en/reference/agent-env/openclaw-options.md) | [私有项目录](private-items.md)

这是 OpenClaw Adapter 的私有 item，不是公共标准 bean。将它与公共 adapter 路由放在同一 agentEnv.items 中；已有 options 合入同一 payload，重复 namespace/name 非法。OpenClaw 使用 Provider 工作区，不要求本地 workspace。

## Payload

| 字段             | 类型、缺省与行为                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`        | 可选字符串，匹配 `^[a-z0-9_][a-z0-9_-]{0,63}$`；省略或 null 为 main，空字符串/非法值拒绝。目标须已存在；续接 session key 前缀与回执 agentId 须匹配，否则 OPENCLAW_SESSION_AGENT_MISMATCH。 |
| `timeoutSeconds` | 可选有限正数，单位秒，非法值拒绝。省略时本地等待预算为 30 分钟，不发送原生 timeout；显式值的原生 timeout 向下取整。与公共 watchdog 独立。                                                |

### 完整 Item 示例

```json
{
  "namespace": "adapter.openclaw",
  "name": "options",
  "payload": {
    "agentId": "main"
  }
}
```

## 边界与所有权

这些字段由本包消费校验，不加入公共 Schema 或生成类型。不同字段的非法值策略以上表为准，不能统一假定静默忽略或自动拒绝。未使用的未知字段不代表受支持。model/effort 使用公共 model item。

Gateway URL、token 与设备身份由可信本地上下文传递，不放入信封。该 Adapter 拒绝非空本轮 envs 与 MCP，使用 Provider 工作区；不支持图片。

## 包入口与实现

[openclaw README](../../../../packages/octo-runtime-adapter-openclaw/README.zh.md), [实现目录](../../../../packages/octo-runtime-adapter-openclaw/src/).
