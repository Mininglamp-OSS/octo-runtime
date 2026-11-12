# adapter.grok-build/options

[English](../../../en/reference/agent-env/grok-build-options.md) | [私有项目录](private-items.md)

这是所属 Adapter 的私有 item，不是公共标准 bean。将它与公共 adapter 路由、所需 workspace 放在同一 agentEnv.items 中；已有 options 合入同一 payload，重复 namespace/name 非法。

**modeId 是 Provider 的工作模式 ID，不是模型 ID。模型 ID 使用 octo.execution/model.payload.selection.id；两者分别校验、分别设置，不互相推导。**

## Payload

| 字段      | 类型、缺省与行为                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modeId`  | 只接受 default / plan；省略不发 setter、不重置。显式值发送 session/set_mode，不要求 ACP modes 广告；非法值或 setter 失败直接失败，不降级。不改变审批/yoloMode 或 exit_plan_mode。 |
| `sandbox` | 本轮显式 sandbox 不受支持，报 SANDBOX_UNSUPPORTED。                                                                                                                               |

### 完整 Item 示例

```json
{
  "namespace": "adapter.grok-build",
  "name": "options",
  "payload": {
    "modeId": "plan"
  }
}
```

## 边界与所有权

这些字段由本包消费校验，不加入公共 Schema 或生成类型。不同字段的非法值策略以上表为准，不能统一假定静默忽略或自动拒绝。未使用的未知字段不代表受支持。model/effort 使用公共 model item。

## 包入口与实现

[grok-build README](../../../../packages/octo-runtime-adapter-grok-build/README.zh.md), [实现目录](../../../../packages/octo-runtime-adapter-grok-build/src/).
