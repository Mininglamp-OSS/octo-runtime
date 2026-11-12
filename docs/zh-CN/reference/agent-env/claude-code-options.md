# adapter.claude-code/options

[English](../../../en/reference/agent-env/claude-code-options.md) | [私有项目录](private-items.md)

这是所属 Adapter 的私有 item，不是公共标准 bean。将它与公共 adapter 路由、所需 workspace 放在同一 agentEnv.items 中；已有 options 合入同一 payload，重复 namespace/name 非法。

## Payload

| 字段             | 类型、缺省与行为                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissionMode` | 只接受 plan；null、default 等拒绝。省略时 ask → default、assisted → auto、full_access → bypassPermissions。显式 plan 优先，即使 full_access 也不追加 --dangerously-skip-permissions；交互授权不变。原生 init 未确认时只保留诊断，不伪造模式证据。 |

### 完整 Item 示例

```json
{
  "namespace": "adapter.claude-code",
  "name": "options",
  "payload": {
    "permissionMode": "plan"
  }
}
```

## 边界与所有权

这些字段由本包消费校验，不加入公共 Schema 或生成类型。不同字段的非法值策略以上表为准，不能统一假定静默忽略或自动拒绝。未使用的未知字段不代表受支持。model/effort 使用公共 model item。

## 包入口与实现

[claude-code README](../../../../packages/octo-runtime-adapter-claude-code/README.zh.md), [实现目录](../../../../packages/octo-runtime-adapter-claude-code/src/).
