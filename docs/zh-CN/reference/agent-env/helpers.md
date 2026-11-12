# AgentEnv 辅助 API

[English](../../../en/reference/agent-env/helpers.md) | [AgentEnv 标准参考](../agent-env-standard.md)

本页是 AgentEnv 标准参考的附属 API 文档，供源码 SDK 调用方构造、读取与合并 AgentEnv。调用 invoke 时传入已经准备好的完整信封；这些辅助函数按需显式调用。

## 构造与替换

### 示例

```ts
import { defaultAgentEnv, withAgentEnvItems } from "@mininglamp-oss/octo-runtime-adapter-sdk";

const agentEnv = withAgentEnvItems(defaultAgentEnv("codex"), [
  {
    namespace: "octo.execution",
    name: "workspace",
    payload: { path: "/absolute/prepared/project" }
  }
]);
```

### 参数与返回值

以下 API 从 `@mininglamp-oss/octo-runtime-adapter-sdk` 导入。

| API | 参数与返回值 |
| --- | --- |
| `defaultAgentEnv(type)` | type 为 Adapter 类型字符串；返回独立 AgentEnv，含 Adapter、ask 审批和整轮 24 小时预算条目。 |
| `withAgentEnvItems(env, items)` | env 为 AgentEnv 或 undefined，items 为 ContextItem[]；同名条目整项替换，保留其他项顺序，新项追加；返回独立 AgentEnv。 |
| `withAgentEnvDefaults(submitted, defaults)` | 两个参数均为完整 AgentEnv；只从第二个参数补充第一个参数缺少的条目；返回独立 AgentEnv。 |

### 注意事项

这些函数不准备工作目录、不选择模型。替换或补齐按 namespace/name 匹配，保留已有条目时不合并其 payload。同一输入信封内的重复键拒绝。结果仍需通过对应 Adapter 的语义校验。

## 读取条目

### 示例

```ts
import { agentEnvItem } from "@mininglamp-oss/octo-runtime-adapter-sdk";

const workspace = agentEnvItem<{ path: string }>(agentEnv, "octo.execution", "workspace");
```

### 参数与返回值

以下 API 从 Adapter SDK 导入。

| API | 参数与返回值 |
| --- | --- |
| `agentEnvItem<T>(env, namespace, name)` | 精确匹配条目，返回原 payload 引用或 undefined；T 只提供静态类型提示。 |
| `invocationModel(request)` | request 为 InvokeRequest；返回 selection.id 或 undefined。 |
| `invocationEffort(request)` | 返回 reasoning.effort 或 undefined。 |
| `invocationWorkdir(request)` | 返回 workspace.path，缺失时为 ""。 |
| `invocationApprovalMode(request)` | 返回审批模式，省略时为 ask；校验模式取值。 |

### 注意事项

读取结果只读使用。泛型不执行运行时校验；必填检查、字段校验和 Provider 映射由 Adapter 完成。模型、思考强度和路径读取函数不证明配置已生效或资源可用。

## 合并信封

### 示例

```ts
import { mergeContext } from "@mininglamp-oss/octo-runtime-protocol";

const merged = mergeContext(
  {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "envs", payload: {
        env_variables: [{ key: "PROJECT_ID", value: "base" }]
      } }
    ]
  },
  {
    schema: "octo.context-envelope/v3",
    items: [
      { namespace: "octo.execution", name: "envs", payload: {
        env_variables: [{ key: "PROJECT_ID", value: "selected" }, { key: "REGION", value: "eu" }]
      } }
    ]
  }
);
```

结果中的 PROJECT_ID 为 selected，并保留 REGION=eu。

### 参数与返回值

`mergeContext(defaults, overrides)` 从源码 protocol 包导入，两个参数均为完整 AgentEnv，返回独立的合并信封。参数名表示该次函数调用的输入顺序。

| 条目 | 同名条目的合并行为 |
| --- | --- |
| model | payload 第一层合并 selection、reasoning；内部对象整项替换。 |
| limits | 按预算字段覆盖。 |
| envs | 按 env_variables 的 key 合并。 |
| mcp | 按 server 名称合并；同名 server 整项替换。 |
| adapter、workspace、approval_policy、私有项 | 整项替换。 |

### 注意事项

后一个参数覆盖前一个参数。省略值或空列表/map 不清除前一个参数的条目；调用方可先调整输入信封再合并。同名 MCP server 不深合并 headers/env。函数不授予权限，也不证明 Provider 支持配置。

## resolveContextConfiguration

### 参数与返回值

源码 protocol 包还提供 `resolveContextConfiguration(configuration, request)`，返回独立 AgentEnv。

| 参数 | 定义 |
| --- | --- |
| `configuration` | 此函数使用的对象，包含必填 defaults、mandatory；二者均为完整 AgentEnv，允许空 items。 |
| `request` | 完整 AgentEnv。 |

该函数先合并 configuration.defaults 与 request，再用 configuration.mandatory 中的条目覆盖；同名项采用上表的合并行为。defaults、mandatory 是这个辅助函数的参数字段，不是 AgentEnv 的字段或执行时的配置层。

### 注意事项

只有显式调用此函数才发生上述处理。invoke 消费最终 AgentEnv，不自动运行该函数。冲突值按顺序覆盖，不作为配置冲突错误返回。

来源：[Adapter SDK](../../../../packages/octo-runtime-adapter-sdk/src/agent-env.ts)、[mergeContext](../../../../packages/octo-runtime-protocol/src/context.ts)、[resolveContextConfiguration](../../../../packages/octo-runtime-protocol/src/context-configuration.ts)。
