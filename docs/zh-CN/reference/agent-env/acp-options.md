# ACP modeId

[English](../../../en/reference/agent-env/acp-options.md) | [私有项目录](private-items.md)

共享 ACP 实现使用各 Adapter 自己的私有 options item，实际 namespace 按 type 替换。不是公共标准项；Grok Build 使用不同 setter 合同，见其专页。

**modeId 是 Provider 的工作模式 ID，不是模型 ID。模型 ID 使用 octo.execution/model.payload.selection.id；两者分别校验、分别设置，不互相推导。**

## 适用 Item

| Item                         | 包入口                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `adapter.acp/options`        | [acp](../../../../packages/octo-runtime-adapter-acp/README.zh.md)               |
| `adapter.hermes/options`     | [hermes](../../../../packages/octo-runtime-adapter-hermes/README.zh.md)         |
| `adapter.kimi-code/options`  | [kimi-code](../../../../packages/octo-runtime-adapter-kimi-code/README.zh.md)   |
| `adapter.mcode/options`      | [mcode](../../../../packages/octo-runtime-adapter-mcode/README.zh.md)           |
| `adapter.qodercli/options`   | [qodercli](../../../../packages/octo-runtime-adapter-qodercli/README.zh.md)     |
| `adapter.qoderclicn/options` | [qoderclicn](../../../../packages/octo-runtime-adapter-qoderclicn/README.zh.md) |
| `adapter.opencode/options`   | [opencode](../../../../packages/octo-runtime-adapter-opencode/README.zh.md)     |

## Payload

可选 modeId 必须是非空、非纯空白字符串，按原值精确匹配本次原生广告，不 trim、不将 default 转为 build。省略不探测或设置模式，不重置续接会话。

```json
{
  "namespace": "adapter.hermes",
  "name": "options",
  "payload": { "modeId": "plan" }
}
```

示例 plan 仅表示形状，不能据此推断目标 Provider 支持该 ID。多个选项合并到同一个 payload，不重复 item。

### 广告与 Setter

优先采用 mode config option（支持分组选项）及真实 configId，否则采用 modes.availableModes。无广告、不支持值、缺 configId 或 RPC 拒绝直接失败，不替换目标模式。当前值相同时不发 setter，否则调用 session/set_config_option 或 session/set_mode；setter 成功只表示受理，不伪造生效证据。

### OpenCode

仅 ask 走 ACP 并支持 modeId。full_access 走 JSON CLI，显式 modeId 在启动前报 OPENCODE_MODE_UNSUPPORTED；不会因此改变审批模式或传输。assisted 不支持。

## 边界与来源

modeId 不改变 approval_policy；model/effort 仍使用公共 model item。私有参数不登记公共 Schema。CodeBuddy 目前不消费共享 ACP modeId helper，不能因为它采用 ACP 传输就推断支持此项。Antigravity 也没有本专题列出的私有模式项。

[ACP implementation](../../../../packages/octo-runtime-adapter-acp/src/index.ts), [OpenCode implementation](../../../../packages/octo-runtime-adapter-opencode/src/index.ts), [Grok Build](grok-build-options.md).
