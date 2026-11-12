# adapter.dsh/options

[English](../../../en/reference/agent-env/dsh-options.md) | [私有项目录](private-items.md)

这是所属 Adapter 的私有 item，不是公共标准 bean。将它与公共 adapter 路由、所需 workspace 放在同一 agentEnv.items 中；已有 options 合入同一 payload，重复 namespace/name 非法。

## Payload

| 字段                           | 类型、缺省与行为                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dshBin`                       | 必需，由宿主选择的已存在 npm JS 入口绝对路径（.js/.mjs/.cjs）；不接受 Desktop/ASAR、cmd shim、相对路径。可信宿主 providerOptions 可覆盖本项，并须与 probe 一致。 |
| `dshHome`                      | 可选字符串；设置本轮 DSH_HOME。                                                                                                                                  |
| `profile`                      | 可选字符串，默认 sdk。                                                                                                                                           |
| `provider`                     | 可选字符串，默认 deepseek-account。                                                                                                                              |
| `initializeTimeoutMs`          | 1–86,400,000 整数或纯数字字符串，默认 15,000 毫秒。                                                                                                              |
| `requestTimeoutMs`             | 范围同上，默认 30,000 毫秒。                                                                                                                                     |
| `shutdownTimeoutMs`            | 范围同上，默认 1,000 毫秒。                                                                                                                                      |
| `maxTokens`                    | 可选，1–86,400,000 整数或纯数字字符串；省略时不发送。                                                                                                            |
| `sandbox`                      | 只能省略或 danger-full-access；要求公共 approval_policy 为 full_access。                                                                                         |

### 完整 Item 示例

```json
{
  "namespace": "adapter.dsh",
  "name": "options",
  "payload": {
    "dshBin": "/absolute/installed/dsh/lib/bin.js"
  }
}
```

## 边界与所有权

这些字段由本包消费校验，不加入公共 Schema 或生成类型。不同字段的非法值策略以上表为准，不能统一假定静默忽略或自动拒绝。未使用的未知字段不代表受支持。model/effort 使用公共 model item。

DSH 字符串选项须非纯空白、不含 NUL、最多 4096 字符；原值传递。外部 Provider 须满足本包最低版本检查；默认模型 deepseek-flash 属于本 Adapter 的初始化行为。官方 SDK 接入为实验性，清理与内存保证见包说明。

## 包入口与实现

[dsh README](../../../../packages/octo-runtime-adapter-dsh/README.zh.md), [实现目录](../../../../packages/octo-runtime-adapter-dsh/src/).
