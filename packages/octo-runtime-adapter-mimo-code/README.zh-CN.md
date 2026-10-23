# MiMo Code ACP Adapter

[English](README.md)

Adapter type 为 `mimo-code`，每轮启动 `mimo acp`，与 Kimi Code 一样复用共享 ACP 的会话、模型选择、canonical 流、权限交互、取消与清理。Gateway 继续走统一的准入、Context、交互和消息投递链。

## 配置名称

| 配置位置                                                      | 填写值                    |
| ------------------------------------------------------------- | ------------------------- |
| 公开 SDK/CLI Context 的 `octo.execution/adapter.payload.type` | `mimo-code`               |
| Channel Gateway 的 `bots[].adapter.adapter_type`              | `mimo-code`               |
| 可执行文件与启动命令                                          | `mimo`，启动为 `mimo acp` |

`mimoi` 没有注册为 Adapter 类型或别名。Adapter 类型与 MiMo 模型 ID 分别配置。

## 准备与用法

按[官方说明](https://github.com/XiaomiMiMo/MiMo-Code#quick-start)自行安装 MiMo Code，让 worker 的 PATH 能找到 `mimo`，使用同一操作系统账号运行 `mimo` 配置 Provider、模型和认证。Runtime 不安装 MiMo、不检查凭据文件、不改写其配置。probe 只判断可执行文件，不能证明登录态或模型可用。

实测版本为 [v0.1.15](https://github.com/XiaomiMiMo/MiMo-Code/releases/tag/v0.1.15)，[ACP 入口](https://github.com/XiaomiMiMo/MiMo-Code/blob/v0.1.15/packages/opencode/src/cli/cmd/acp.ts)包含 `acp` 子命令、NDJSON stdio 和进程内 HTTP 服务。

**上游 ACP 实现存在已知问题，验收被阻塞**：MiMo Code 0.1.15 可能先返回带有 `stopReason: "end_turn"` 的 `session/prompt` 响应，再发送同一轮剩余的 `agent_message_chunk` 通知，导致 Adapter 输出截断。问题已提交至 [XiaomiMiMo/MiMo-Code#2709](https://github.com/XiaomiMiMo/MiMo-Code/issues/2709)，包含独立复现脚本和 ACP 生命周期依据。当前 Adapter 等待上游修复；修复版本发布后，须重新完成 SDK/CLI 与 Gateway 端到端验收，再评估生产可用性。可执行文件 probe 成功不代表兼容，目前没有 MiMo Code 发行版本通过本 Adapter 的最终验收。

2026-10-23 macOS arm64 实际执行复用了用户配置，MiMo 回报模型为 `deepseek/deepseek-flash`；验证对象是 MiMo Code CLI，并不代表使用了小米托管的模型端点。未读取或更改用户认证文件及 Provider 配置。

已安装的程序也可能不在 worker 的 PATH 中。macOS/Linux 若安装于 `~/.mimocode/bin/mimo`，可在启动宿主的环境中加入该目录，或使用下文的工厂 command 覆盖：

```sh
export PATH="$HOME/.mimocode/bin:$PATH"
mimo --version
mimo acp --help
```

已有宿主或服务须以更新后的环境重启；shell 别名或其他终端中的 export 不会更新正在运行的进程。

SDK 在宿主内部 worker 原生 import `mimoCodeAdapter` 并传给 `serveWorker`；宿主管理 worker 生命周期，共享 ACP 管理每轮 MiMo 子进程。包沿用 private workspace 约定，随主发行物携带，不单独发布；SDK 产品自行选择部署模块，见[模块载入](../../docs/zh-CN/concepts/module-loading.md)。完整 SDK 与 JSON 示例见 [English](README.md#sdk-and-cli)。

```sh
octo-runtime executor-kernel start
octo-runtime adapter probe mimo-code
octo-runtime playboard < ./mimo-request.json
```

公开 InvokeInput 设置 `protocol_mode: "canonical"`，并在 Context v3 添加 `{ "namespace": "octo.execution", "name": "adapter", "payload": { "type": "mimo-code" } }`。Gateway 在已有 Bot 条目中设置以下 adapter 片段：

```json
{
  "adapter": {
    "adapter_type": "mimo-code"
  }
}
```

自定义路径使用 `createMimoCodeAdapter({ command: "/absolute/path/to/mimo" })`。CLI 可用完整替换的 `--manifest` 声明该工厂，设置 `factory: true`、`export: "createMimoCodeAdapter"` 及 `options.command`；Home 扩展不能覆盖同名内置 Adapter。

## 执行边界与验收状态

- cwd、逐轮独立环境和 MCP 沿共享 ACP 转发；HTTP MCP 与图片须由 Provider 原生声明支持。显式模型必须由 session 广告，并通过现有 setter 选择；不静默退回其他模型。
- 续聊使用 `session/load`，真实不支持或失败原样返回。普通业务 Context 每轮保序渲染，执行配置与模型正文分离，不自动补历史。
- `ask`、`full_access` 沿共享权限桥；拒绝 `assisted`。未实现原生 effort setter，显式 effort 返回统一未应用提示。仅支持 canonical 输出。
- fixture 覆盖选择、启动/cwd/独立环境、流、模型选择、续聊、真实错误保留、取消和复用。构建后运行 `node scripts/verify-mimo-code.mjs` 可复验真实 SDK/CLI；0.1.15 的正文精确断言会暴露上游截断。
- 定时等待尾流的实验因无法证明正文完整，在代码审查后移除；最终 Adapter 使用标准 ACP 完成边界，不以静默时间猜测完整性。
- 实验性 SDK/CLI 和线上 Gateway 已观察到模型执行、续聊、工具、取消与群回复，但不能作为最终实现的验收依据。浏览器中已登录的人类账号可触发 Gateway 私聊，最终薄适配器仍因上游问题返回截断正文。当前保留 Runtime 变更，等待上游修复后复验，发行验收尚未完成。
- MCP/图片及真实交互审批尚未验证。证据与阻塞项见[验收记录](../../.octospec/journal/shared/2026-10-23-16-mimo-code.md)。Linux 与 Windows 10/11 真实 Provider 场景未执行，Windows 继续关联 [#14](https://github.com/Mininglamp-OSS/octo-runtime/issues/14)。

找不到程序时检查服务 PATH 或工厂 command；认证和模型失败先在相同账号、cwd 下直接验证 MiMo。ACP 方法或模型不受支持时检查版本与配置，Runtime 不换 Provider。进程回收沿共享实现，Windows 父进程先退出等场景仍有已知观测限制。
