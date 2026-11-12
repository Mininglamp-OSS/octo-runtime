# AgentEnv 标准参考

[English](../../en/reference/agent-env-standard.md) | [文档目录](../README.md)

## AgentEnv

### 示例

```json
{
  "schema": "octo.context-envelope/v3",
  "items": []
}
```

### Payload

| 字段 | 定义 |
| --- | --- |
| `schema` | 必填，固定为 `octo.context-envelope/v3` |
| `items` | 必填有序数组，0–32 项 |
| `items[].namespace` | 必填字符串，1–96 字符，匹配 `^[a-z0-9][a-z0-9._-]*$` |
| `items[].name` | 必填字符串，规则同 namespace |
| `items[].payload` | 必填 JSON 对象，不接受数组或 null；具体定义见下文各 item |

### 注意事项

一个 AgentEnv 可以包含下文七种公共 item 及 Adapter 私有 item，不要求七项全部提供。namespace/name 组合必须唯一；信封与 item 均拒绝未知顶层字段。整个信封最多 65,536 UTF-8 字节，JSON 深度最多 32，不接受 undefined、函数、非有限数值或非法 Unicode。

空 items 可通过结构校验，但不证明目录、Adapter 或认证已准备好。client 调用时冻结快照，首次消费才提交；Core 保序透传，Adapter 消费并校验 payload。执行配置不会自动拼入模型正文。

文本、图片、提示词与历史使用 [inputs](input-parts.md)；Adapter 专属 payload 见 [私有项](agent-env/private-items.md)。modeId 是工作模式 ID，不是模型 ID；模型 ID 使用 octo.execution/model.payload.selection.id。

## `octo.execution/adapter`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "adapter",
  "payload": {
    "type": "codex"
  }
}
```

### Payload

| 字段   | 定义                                                 |
| ------ | ---------------------------------------------------- |
| `type` | 必填非空字符串；必须与宿主注册的 Adapter type 对应。 |

### 注意事项

选择已经注册的执行实现。公共标准项；不选择设备、账号、Provider Agent，也不安装 Provider。

**缺省与执行边界**

省略此项时当前执行入口选择 `codex`，仍要求宿主已注册该实现。声明 type 不会加载模块、构造 Engine 或查找 executable；这些操作由宿主在调用前完成。

`payload` 只允许 `type`。Provider 目标使用对应 Adapter 的私有配置，见[私有项](agent-env/private-items.md)。同一 Provider 会话不得因改 type 自动迁移到另一实现。

## `octo.execution/workspace`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "workspace",
  "payload": {
    "path": "/absolute/prepared/project"
  }
}
```

### Payload

| 字段   | 定义                                                   |
| ------ | ------------------------------------------------------ |
| `path` | 必填非空字符串；本地执行要求已存在、可访问的绝对目录。 |

### 注意事项

指定调用方已经准备好的本地工作目录。公共标准项；目录属于调用方，工作目录不构成操作系统沙箱。

**准备与缺省**

调用方先创建或选择目录，再调用 Runtime。Runtime 不默认取 cwd、不创建目录、不从会话恢复路径，也不在 fresh fallback 时补建目录。声明 `metadata.workspace: false` 的 Adapter 可以没有本地覆盖；OpenClaw 的工作区由 Provider 管理。

**校验与失败**

| 原因码                  | 条件                         |
| ----------------------- | ---------------------------- |
| `WORKDIR_REQUIRED`      | 未提供路径                   |
| `WORKDIR_INVALID`       | 相对路径、NUL 或非法结构     |
| `WORKDIR_NOT_FOUND`     | 路径不存在                   |
| `WORKDIR_NOT_DIRECTORY` | 路径不是目录                 |
| `WORKDIR_UNAVAILABLE`   | 无访问权限或其他文件系统失败 |

以上沿用公开分类 `OH-ADP-3004`。路径检查不能消除后续文件系统竞态。`payload` 只含 `path`。Runtime Home、Provider Home、日志与应用目录分别管理。

## `octo.execution/model`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "model",
  "payload": {
    "selection": {
      "id": "provider-model-id"
    },
    "reasoning": {
      "effort": "high"
    }
  }
}
```

### Payload

| 字段        | 定义                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| `selection` | 可选对象，只允许必填非空字符串 `id`。                                            |
| `reasoning` | 可选对象，只允许必填字符串 `effort`；执行支持 `low`、`medium`、`high`、`xhigh`。 |

### 注意事项

提供本轮模型选择和思考强度。公共标准项；模型标识由实际 Provider 与后端定义，Runtime 不提供统一模型目录。

**缺省与支持范围**

至少提供 selection 或 reasoning 之一。省略 selection 表示不传显式模型，省略 reasoning 表示不传显式强度；两者均不指定时省略整个 item。空对象、空 id/effort 均不是合法缺省写法。恢复原生会话时，省略不保证重置其既有选择。

Adapter 负责原生映射和 Provider 要求的模型确认。effort 降档发 `REASONING_EFFORT_DOWNGRADED`；无 setter 时按既有合同使用原生默认并发 `REASONING_EFFORT_NOT_APPLIED`，不将选择写进提示词。模型不受支持、账号无权限与 Provider 不可连接分别处理。具体映射见[Provider 参考](providers.md)与各 Adapter README。


## `octo.execution/envs`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "envs",
  "payload": {
    "env_variables": [
      {
        "key": "PROJECT_ID",
        "value": "project-123"
      },
      {
        "key": "API_BASE_URL",
        "value": "https://api.example.com"
      }
    ]
  }
}
```

### Payload

| 字段                    | 定义                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `env_variables`         | 必填列表，0–128 项。每项仅含必填 `key`、`value`。                      |
| `env_variables[].key`   | 字符串，匹配 `^[A-Za-z_][A-Za-z0-9_]*$`；列表中精确同名 key 不得重复。 |
| `env_variables[].value` | 不含 NUL 的字符串。空字符串合法；null、数字、布尔值非法。              |

### 注意事项

向本轮执行环境提供变量覆盖。公共标准项，适用于实际在本地消费环境的 Adapter；不是模型正文或远端机器的环境管理接口。

**作用域与优先级**

省略或空列表表示没有本层覆盖。它不删除继承的进程环境变量；没有删除变量操作。值保持字面量，不展开 `${NAME}`、不读 `.env`、不执行 shell。

执行环境依次组合宿主提供的基础环境、本轮 envs、可信宿主覆盖、Adapter 固定传输设置。后层覆盖前层；每轮创建独立对象，不修改全局 `process.env`。Windows 最终环境键不区分大小写；其他平台区分。宿主构造时提供的基础环境不会因后来另一个终端 export 而改变。

**Provider 边界**

常驻 Codex app-server 不按 envs 重建进程，本轮 shell/MCP 环境通过 thread/turn 配置传递。envs 不替换宿主绑定的 executable、账户或 CODEX_HOME。OpenClaw 对非空本轮 envs 报 CONTEXT_ENVS_UNSUPPORTED，不做远端环境注入。

**组合与保密**

整个信封仍有 65,536 字节预算。不要将变量值复制到 inputs、公开事件或日志；工具进程本身可以读取获授权的执行环境。

## `octo.execution/mcp`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "mcp",
  "payload": {
    "mcpServers": {
      "project-tools": {
        "type": "stdio",
        "command": "/absolute/bin/project-mcp",
        "args": ["--project", "${PROJECT_ID}"]
      },
      "project-docs": {
        "type": "streamable_http",
        "url": "https://example.com/mcp",
        "headers": {
          "X-Project-ID": "${PROJECT_ID}"
        }
      }
    }
  }
}
```

### Payload

`payload` 仅含必填 `mcpServers`。它是动态名称 map，最多 32 个 server；名称匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。省略 item 或空 map 表示没有本轮新增连接，不清除 Provider 原生 MCP。

**stdio**

| 字段               | 定义                                                     |
| ------------------ | -------------------------------------------------------- |
| `type`             | 必填，固定为 `stdio`                                     |
| `command`          | 必填非空字符串；由 Provider 启动已准备的程序             |
| `args`             | 可选字符串数组，最多 128 项                              |
| `env`              | 可选字符串 map，最多 128 项；变量名同 envs，值不得含 NUL |
| `cwd`              | 可选非空字符串；取决于 Adapter 是否能表达                |
| `required`         | 可选 boolean；取决于原生支持，不是默认 fail-open 声明    |
| `startupTimeoutMs` | 可选整数，100–300,000 毫秒                               |
| `toolTimeoutMs`    | 可选整数，100–3,600,000 毫秒                             |

stdio 的 env 覆盖传给该 MCP 子进程的同名环境。它不修改整个 Provider 或其他 server 的环境。

**Streamable HTTP**

| 字段                                            | 定义                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `type`                                          | 必填，固定为 `streamable_http`                                                                  |
| `url`                                           | 必填字符串，最多 4096 个字符；模板展开后为绝对 HTTP(S) URL，不得含用户信息、fragment 或控制字符 |
| `headers`                                       | 可选字符串 map，最多 64 项；合法 HTTP header 名称，按大小写不敏感规则唯一；值不得含 CR、LF、NUL |
| `required`、`startupTimeoutMs`、`toolTimeoutMs` | 类型和范围同上；支持范围由 Adapter 决定                                                         |

两个 transport 都拒绝未知字段、混合字段和未知 type。HTTP 不接受 command/env；stdio 不接受 url/headers。

### 注意事项

标准名称为 `octo.execution/mcp`，不是 `mcps`。这是公共执行配置，描述本轮 MCP 连接；不是 MCP 线上报文、组件安装器或 Adapter 私有项。调用方先安装 stdio 程序或准备 HTTP 服务，再提交配置。

示例要求执行环境已提供 PROJECT_ID；可用 envs 传入。业务凭据由宿主从仓库外注入。

**模板展开**

Adapter SDK 在执行主机上读取本轮环境，在 command、args、cwd、env 的值、url、headers 的值中单次展开 `${NAME}`。名称和 key 不展开，替换结果不递归展开。envs 自身的值保持字面量。

`$${NAME}` 保留为字面量 `${NAME}`；Claude Code 因原生二次展开而对最终含 `${` 的值报 `MCP_LITERAL_UNSUPPORTED`。缺失变量报 `MCP_ENV_MISSING`，只展示位置与变量名。展开后重新校验 URL、命令和 headers，不回写原信封或用户配置文件。

**Adapter 映射与失败边界**

| Adapter               | 原生载体与额外选项                                                                     |
| --------------------- | -------------------------------------------------------------------------------------- |
| Codex                 | thread/start、thread/resume 的 config.mcp_servers；支持 cwd/required/两个 timeout      |
| Claude Code           | 私有临时 --mcp-config，HTTP 转 http；不支持上述四个额外选项                            |
| ACP                   | session/new、session/load 的 mcpServers 数组；先检查原生 HTTP 能力，不支持上述额外选项 |
| OpenCode              | V2 CLI 环境配置或 ask 的 ACP 路径；V2 支持 toolTimeoutMs                               |
| 未实现 MCP 的 Adapter | 非空配置报 MCP_UNSUPPORTED                                                             |

无法表达的可选项报 `MCP_OPTION_UNSUPPORTED`。Codex 本轮名称与原生配置重名时（含 disabled）报 `MCP_SERVER_NAME_CONFLICT`，不覆盖或改名。其他原生加载器的优先级见对应包 README，不能假定空 map 隔离了原生工具。

连接、工具发现、实际工具调用和业务授权是不同事实，配置不会改变审批策略。

Grok Build 使用共享 ACP 映射，并额外拒绝展开后含 `${` 的最终配置值（`MCP_LITERAL_UNSUPPORTED`），避免原生层再次展开。

## `octo.execution/limits`

### 示例

```json
{
  "namespace": "octo.execution",
  "name": "limits",
  "payload": {
    "run_timeout_ms": 86400000,
    "model_idle_policy": "observe"
  }
}
```

### Payload

| 字段                     | 范围              | 缺省值         | 含义                                     |
| ------------------------ | ----------------- | -------------- | ---------------------------------------- |
| `first_frame_timeout_ms` | 100–1,800,000     | 60,000         | 启动后首个有效执行进度预算               |
| `model_idle_timeout_ms`  | 100–3,600,000     | 300,000        | 模型活动阶段无有效进度预算               |
| `model_idle_warning_ms`  | 100–3,600,000     | 120,000        | 模型空闲告警阈值                         |
| `model_idle_policy`      | enforce / observe | enforce        | enforce 超时取消；observe 仅观察模型空闲 |
| `tool_timeout_ms`        | 100–86,400,000    | 600,000        | 每个工具无进度预算                       |
| `tool_wall_timeout_ms`   | 100–86,400,000    | 未设置 / unset | 每个工具自启动起的总耗时预算             |
| `run_timeout_ms`         | 100–604,800,000   | 86,400,000     | 整轮总预算，默认 24 小时、最大 7 天      |
| `cancel_grace_ms`        | 100–60,000        | 1,000          | 取消后的宽限预算                         |

### 注意事项

公共标准项，配置 Runtime 本轮 watchdog。所有数值字段都是整数毫秒，范围包含端点；均可省略，由执行层采用下表缺省值。

**计时与失败边界**

Adapter 将 snake_case payload 映射为本地 RuntimeLimits；Core 按本地回调执行 watchdog，不解析 AgentEnv 预算条目。省略整个 item 或提交空 payload 时沿用缺省值，不向原信封添加默认字段。

整轮、首帧、模型空闲、工具空闲与工具总耗时分别计时；工具进度可以刷新空闲计时，不能延长总耗时。模型与等待审批阶段有各自状态，不能用日志或连接心跳冒充有效模型进度。调大 run_timeout_ms 不会延长其他预算。observe 只关闭模型空闲终止，整轮、首帧、工具与取消预算继续有效。

超时请求取消，不代表 Provider 或后代已回收。调用方继续消费原执行终态及清理结果。0、null、Infinity 不表示无限期运行。公开模型文本的 60 秒静默通知是独立的输出观察机制，不受 model_idle_warning_ms 改写，见[输出与控制](output-and-control.md)。

## `octo.security/approval_policy`

### 示例

```json
{
  "namespace": "octo.security",
  "name": "approval_policy",
  "payload": {
    "mode": "ask"
  }
}
```

### Payload

| 字段   | 定义                                         |
| ------ | -------------------------------------------- |
| `mode` | 必填枚举：`ask`、`assisted`、`full_access`。 |

### 注意事项

选择工具审批策略。公共标准项；业务资源授权和工具审批分别处理。

**缺省与原生映射**

SDK helper 缺省为 `ask`；CLI 宿主可显式选择自己的默认值。`ask` 保留人工审批路径，`assisted` 使用 Adapter 的受限辅助策略，`full_access` 在受支持的原生路径放宽工具审批。三者的原生权限范围并不相同，不能从公共名称推导统一 OS 沙箱保证；具体映射见[Provider 参考](providers.md)及所选 Adapter README。

**交互边界**

调用方必须消费并处理需回答的审批请求，按原 invocation 与 interaction 身份回复。`full_access` 不替用户回答追问、信息补充或异步问题，也不证明有业务 API 权限。审批 ACK、执行终态和资源清理完成是不同事实。完整往返 API 见[输出与控制](output-and-control.md)。

此 payload 仅含 mode；其他字段与未知值由消费边界拒绝。

未实现 assisted 的通道（如共享 ACP、OpenCode、OpenClaw）返回 APPROVAL_MODE_UNSUPPORTED；Antigravity 与 DSH 要求显式 full_access。公共枚举存在不代表每个 Adapter 支持全部取值。

## 辅助 API

构造、读取和合并 AgentEnv 的帮助函数见附属文档 [AgentEnv 辅助 API](agent-env/helpers.md)。
