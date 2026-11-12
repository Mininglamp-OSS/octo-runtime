# Adapter 私有项

[English](../../../en/reference/agent-env/private-items.md) | [AgentEnv 标准参考](../agent-env-standard.md)

私有项属于调用方与消费它的 Adapter，不属于七个公共标准项。公共层只校验信封结构，Core 保序透传；无关 Adapter 可以忽略未知项。通过结构校验不表示任何 Adapter 已使用此配置。

## 定义与读取

私有项仍只含 namespace、name、payload。Adapter 用 `agentEnvItem<T>(request.agentEnv, namespace, name)` 读取，缺失返回 undefined；T 只提供静态提示，不做运行时验证。返回原 payload 引用，Adapter 只读使用，自己负责字段、默认值、语义和原生映射。

私有名称无须登记公共 Schema、catalog、生成类型或升级协议版本。`adapter.xxx/options` 是部分内置实现使用的约定，不是公共命名空间规范。不要把 Provider 专属字段塞进公共 adapter/model payload。

## 私有合同入口

| Adapter      | 权威字段与示例                                                                  |
| ------------ | ------------------------------------------------------------------------------- |
| Codex        | [包 README](../../../../packages/octo-runtime-adapter-codex/README.zh.md)       |
| Claude Code  | [包 README](../../../../packages/octo-runtime-adapter-claude-code/README.zh.md) |
| OpenClaw     | [包 README](../../../../packages/octo-runtime-adapter-openclaw/README.zh.md)    |
| OpenCode     | [包 README](../../../../packages/octo-runtime-adapter-opencode/README.zh.md)    |
| 其他 Adapter | [包目录](../../../../packages/README.zh.md)及对应 Adapter README                |

本目录提供公共与专属配置之间的导航。自定义宿主构造与 Adapter 消费代码见[SDK 接入](../../getting-started/sdk.md)。可信连接认证通过宿主本地上下文传递，不回写调用方信封。

## 与业务材料的边界

人格、启动提示词、历史、资源地址和业务格式由调用方组成 inputs。未知 item 不会自动进入模型正文，也不触发资源抓取或历史合并。endpoint 选择、设备调度和故障转移归调用方，不注册为 Runtime 公共执行项。

## 专属字段参考

| Item                                           | 详细定义                                           |
| ---------------------------------------------- | -------------------------------------------------- |
| `adapter.codex/options`                        | [codex](codex-options.md)                          |
| `adapter.claude-code/options`                  | [claude-code](claude-code-options.md)              |
| `adapter.grok-build/options`                   | [grok-build](grok-build-options.md)                |
| `adapter.openclaw/options`                     | [openclaw](openclaw-options.md)                    |
| `adapter.dsh/options`                          | [dsh](dsh-options.md)                              |
| ACP / Hermes / Kimi / MCode / Qoder / OpenCode | [modeId：工作模式 ID，不是模型 ID](acp-options.md) |

这些页面由对应包维护，包 README 是配置合同入口；此目录不将私有字段升级为公共协议。
