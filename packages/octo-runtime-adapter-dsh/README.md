# DeepSeek Harness Adapter

`dsh` 是独立的 canonical Adapter。KernelClient 经 Kernel worker 调用本机已安装的 DeepSeek Harness；不控制 Desktop 窗口，不安装 Provider，不修改用户 profile 或认证文件。

## 支持版本和入口

直接使用官方 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` 的 `HarnessClient`，不自行实现 JSON-RPC Client。该版本是 2026-10-25 查询 npm 得到的最高版本，标签为 `next`；上游 `latest` 标签仍指向旧版，故显式锁定版本。

当前支持同版 `@deepseek-ai/dsh@0.2.1-rc.3`、SDK wire `deepseek-harness-sdk-runtime/0.0.1`。本机验证的 Desktop commit 为 `be72761ee1a6736ebcdf4f3739363b083ae53c98`。升级后版本检查明确失败，需要重新核对原生合同。

默认优先使用 PATH 中的 `dsh`；macOS 找不到时使用 `/Applications/DeepSeek Harness.app` 内嵌的 CLI。官方 Client 用 Node 启动 `dshBin`；Desktop 入口通过 `execve` 保留该进程的 PID/stdio，切换到 Electron 和 asar 内 CLI，不另建协议代理。其他安装位置使用 `desktopPath`。Windows/Linux 可以通过 `dshBin` 显式选择 Node CLI module；本次未验证其真实 DSH 发行版。

先在 Desktop 登录，再以同一操作系统账号启动 Runtime。默认 `profile=sdk`、`provider=deepseek-account`、`model=deepseek-flash`，复用 Provider 自己的凭据解析；API key 路径需显式选择 `deepseek-official` 并由宿主准备。默认不会根据缺少某个环境变量猜测登录状态。

```sh
octo-runtime adapter probe dsh
```

probe 只证明兼容入口可运行，不证明账户、模型或工具可用。真实验证入口：仓库构建后运行 `node scripts/verify-dsh-live.mjs`，会调用模型并在临时工作目录写入验证文件。

## SDK 与 CLI

主发行包导出 `@mininglamp-oss/octo-runtime/adapters/dsh`。宿主维护的独立 worker 文件：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";
serveWorker([dshAdapter]);
```

宿主在本进程构造 `createKernelService({endpoint, workerEntrypoint})`，业务调用 `kernel.client.invoke(input)`；完整所有权示例见 [原生服务指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。不需要 SDK manifest。CLI 内置 manifest 已注册 `dsh`；Gateway 只需设置 `adapter.adapter_type="dsh"`，保持已有 DM/群授权、卡片和会话管理链路。

本轮请求必须显式使用 canonical 和 full_access：

```json
{
  "inputs": [{ "type": "text", "text": "Reply OK" }],
  "protocol_mode": "canonical",
  "contexts": {
    "schema": "octo.context-envelope/v3",
    "items": [
      { "namespace": "octo.execution", "name": "adapter", "payload": { "type": "dsh" } },
      { "namespace": "octo.execution", "name": "workspace", "payload": { "mode": "fixed", "path": "/absolute/project" } },
      { "namespace": "octo.security", "name": "approval_policy", "payload": { "mode": "full_access" } }
    ]
  }
}
```

调用方保存真实 `session.update.payload.providerSession`，续聊原样传回。Adapter 先原生 resume，再设置本轮工作目录，最后发送本轮输入；恢复失败不会另建会话。可信 controlInstructions 只在新会话中作为独立 user text block 发送，不冒充原生 system prompt。普通业务 Context 每轮由 Core 渲染，不从 Provider 历史补齐。

执行参数位于 `agentConfig.providerOptions`；CLI profile 中使用 `adapters.dsh.execution.provider_options`，其值须为字符串。SDK 的 `args` 仅支持字符串数组，CLI 字符串配置不支持该数组。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `dshBin` | 自动发现 | 官方 Client 的 Node CLI module 路径；与 command/args/desktopPath 互斥 |
| `command`、`args` | 自动发现 | 保留 Node executable 加单个 CLI module 的旧配置；任意 executable/argv 组合明确拒绝，改用 dshBin |
| `desktopPath` | macOS 默认安装位置 | 绝对 `.app` 路径；当前仅 macOS |
| `profile` | `sdk` | 使用已有 SDK profile；自定义 profile 必须暴露同一 RPC 服务 |
| `dshHome` | Provider 原生默认 | 子进程的 DSH_HOME；宿主负责准备和保护 |
| `provider` | `deepseek-account` | 原生 provider ID |
| `maxTokens` | 原生默认 | 正整数输出上限；model 使用 `agentConfig.model` 或本轮 model Context |
| `initializeTimeoutMs` | 15000 | 握手期限，毫秒 |
| `requestTimeoutMs` | 30000 | 普通 RPC 期限，毫秒 |
| `shutdownTimeoutMs` | 1000 | shutdown 回执期限，毫秒；随后仍确认拥有进程退出 |

`session/wait` 使用本轮 runTimeoutMs，未指定时为 120000 毫秒。版本探针有独立 10000 毫秒期限，也观察取消并回收进程树。Adapter 在官方通知回调中同步投影并检查通知大小，canonical 队列沿 Runtime StreamLimitPolicy。

补丁还限制 SDK 自身的诊断与关系表：未换行 stderr 后缀最多 16384 个 UTF-16 code unit，保留尾部总量最多 65536 UTF-8 bytes；SDK lineage 最多 128 项，身份最长 191 字符。无关会话通知同样消耗 SDK 的关系预算，超量以 STREAM_QUEUE_ITEMS_EXCEEDED 失败；不会用 filter 丢弃来掩盖内存增长。

上游原版 SDK 0.2.1-rc.3 没有解析前行字节上限。本项目通过 `pnpm patchedDependencies` 固定两个可审查补丁：Client 接收本轮字节预算和受管进程清理函数；官方 Protocol 在 StringDecoder、字符串拼接和 JSON.parse 之前逐段计数字节，覆盖响应、通知以及尚无换行的数据。超限以 PROVIDER_MESSAGE_TOO_LARGE 失败并关闭本轮传输。CRLF 中的 CR 计入行预算，LF 分隔符不计入；恰好等于上限仍可接收。补丁随源码及发行包保留，不声称这些扩展已经上游发布。非 JSON 行仍按上游行为忽略，无有效初始化响应最终超时失败。订阅过滤回调返回 false，避免在 SDK 内额外积累通知队列。

## 输出和限制

原生 prompt 回执只表示入队。成功还需关联 receipt、root turn/end=completed、非空 committed answer、session/wait 成功，以及拥有进程清理完成。只收到 idle、空回答、EOF 或 enqueue ACK 都不会报成功。

本版 SDK 在消息提交后转发 compact text-chunks，Adapter 重放这些增量并与 committed snapshot 对账；这不是实时逐 token 流。工具参数从原生 JSON 字符串解析，结果使用 toolCallId 关联；单工具失败不替代 root 的终态。Child 仅在发现原生 lineage 后纳入，文本使用 commentary，不混入 root final。原生 reasoning 标记 analysis/private_reasoning 和来源，公共卡片不能展示该内容。usage 只传递已报告的数值，不估算 token。

本版 SDK 没有交互审批传输，因此只接受调用方明确选择的 full_access，原生权限固定为 danger-full-access；ask/assisted 在启动前拒绝。工作目录不是沙箱。非 default actmode、逐轮 MCP 不支持时明确拒绝；effort 没有 setter，沿统一 notice 回执说明未应用。

每轮独占一个官方 HarnessClient；取消调用其 close，不终止 Desktop GUI 或兄弟调用。Client 补丁在 spawn 时建立独立 POSIX 进程组并捕获 Adapter SDK 现有 createProcessCleanup；shutdown 后由同一函数完成 TERM、KILL 和退出确认，父进程已退出也继续回收所属组。只有确认后才输出唯一终态；回收失败保留执行和清理两种原因。Windows 使用现有 taskkill /T 路径，真实 Windows DSH 与父进程先退出后的工具回收尚未验收，不将 POSIX 结果推广到 Windows。Session 文件由 DSH 原生管理，Adapter 不另存业务历史。

失败沿共同 FailureEnvelope：公共 OH 分类码在 `payload.failure.code`，DSH 稳定原因在 `payload.failure.reasonCode` 和顶层兼容 `code`。例如 DSH_SESSION_RESUME_FAILED、DSH_INITIALIZE_TIMEOUT、DSH_REQUEST_TIMEOUT、DSH_TRANSPORT_CLOSED、DSH_TRAJECTORY_INVALID、DSH_EXECUTION_FAILED、DSH_NO_FINAL_OUTPUT、DSH_CANCEL_FAILED、DSH_CLEANUP_FAILED。容量超限保留共同 PROVIDER_MESSAGE_TOO_LARGE / STREAM_QUEUE_* 原因码。Core 日志保留公共码与 reason_code；Adapter 经 invocation context 复用同一日志入口，记录有界阶段、时间、原生安全 code，不记录 prompt、凭据、原生 error.message 或 stderr。官方公共 API 不暴露 PID/request ID，故不读取私有字段或解析其错误文本。独立调用可用 `createDshAdapter({log})` 提供同一受控 RuntimeLog；错误不自动重发模型或工具。

源码声明官方 Client 精确生产依赖。构建发行包时，esbuild 按实际 import 收集应用补丁后的官方 Client 和官方 SDK Protocol 的 JavaScript，保留 workspace 依赖为外部包并记录上游版本、补丁和 MIT 许可。Adapter 始终传入显式 dshBin，因此不使用官方 SDK 自动解析 npm Provider 的默认路径；发行包不携带整套 Provider 或平台原生模块，不在消费者安装时下载 Provider。离线包验证覆盖这条路径。
