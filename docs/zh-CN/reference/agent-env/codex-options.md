# adapter.codex/options

[English](../../../en/reference/agent-env/codex-options.md) | [私有项目录](private-items.md)

这是所属 Adapter 的私有 item，不是公共标准 bean。将它与公共 adapter 路由、所需 workspace 放在同一 agentEnv.items 中；已有 options 合入同一 payload，重复 namespace/name 非法。

## Payload

| 字段                        | 类型、缺省与行为                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collaborationMode`         | default / plan；省略不探测、不覆盖或重置。显式值须在 Provider 广告中；缺模型、无支持或 RPC 拒绝均失败。原生 settings 优先显式 model/effort，否则用线程响应。 |
| `reasoningSummary`          | auto / concise / detailed / none；省略或非字符串采用 auto；未知字符串失败。                                                                                  |
| `sandbox`                   | read-only / workspace-write / danger-full-access；非 full_access 默认 workspace-write，不能请求 danger-full-access。full_access 固定 danger-full-access。    |
| `appServerRequestTimeoutMs` | 有限正数毫秒，默认 30,000；非法值采用默认。单次 app-server RPC 截止时间。                                                                                    |
| `finalizationTimeoutMs`     | 有限正数毫秒，默认 15,000；非法值采用默认。只影响符合条件的 final_answer 收尾 fallback，不是整轮预算。                                                       |

### 完整 Item 示例

```json
{
  "namespace": "adapter.codex",
  "name": "options",
  "payload": {
    "collaborationMode": "plan"
  }
}
```

## 边界与所有权

这些字段由本包消费校验，不加入公共 Schema 或生成类型。不同字段的非法值策略以上表为准，不能统一假定静默忽略或自动拒绝。未使用的未知字段不代表受支持。model/effort 使用公共 model item。

## 包入口与实现

[codex README](../../../../packages/octo-runtime-adapter-codex/README.zh.md), [实现目录](../../../../packages/octo-runtime-adapter-codex/src/).
