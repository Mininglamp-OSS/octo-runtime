---
type: Task
title: Issue 51 三语言原生 RPC Client 规划
description: 从共享 Schema 生成 Go、Rust、Python Invoke SDK，并以真实 TypeScript Kernel 和跨平台故障矩阵验收。
tags: [architecture, protocol, schema, ipc, invoke, native, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 目标与当前状态

需求来源为 [Issue #51](https://github.com/Mininglamp-OSS/octo-runtime/issues/51)，包括最后追加的 Go、Rust、Python 三语言要求。目标是在仓库根目录 `native/` 交付三个普通语言包，直接连接现有 Kernel，支持高层流式 Invoke 及全部公开 RPC。SDK 安装后的客户端不依赖 Node.js、生成器或运行时 Schema 文件；TS Kernel 服务端仍需其既有 Node.js 环境。

本轮仅执行 OctoSpec 规划。基线为 `origin/main@445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`，分支 `codex/51-native-rpc-clients`，worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-51-native-rpc`。尚未实现 SDK、运行互操作测试、提交或推送。规划准备度自评 **96/100**，依据和扣分见 [assessment](assessment.md)，不代表功能完成或成功概率。

## 产品意图与责任

| 范围检查 | 本任务决定 |
| --- | --- |
| 真实需求 | Go 二进制、Rust 程序和 Python 应用不嵌入 TS 执行引擎，也能复用本机同一执行服务。 |
| 决定权 | 业务方选择模型、模式、会话、Context、重试和部署；SDK 处理公共协议、原身份恢复、取消及资源上限。 |
| 显式输入 | 既有 endpoint、InvokeInput、可选独立环境、客户端取消与 deadline；不扫描 Home 猜目标。 |
| 正常执行 | 原生 Client → 本地 UDS / Windows named pipe → 既有 TS Kernel → 隔离 worker → 唯一 AgentExecutor → Adapter。 |
| 资源所有权 | SDK 仅拥有本客户端连接、I/O 任务、取消任务和有界调用元数据；不拥有 Kernel、worker、Provider 或宿主数据库。 |
| 最先存在的缺口 | 公开 wire Schema 缺少精确 input/response 和 method/result/notification 映射，先在 Protocol 补齐，不能由三语言各自猜测。 |
| 其他产品影响 | 不改变 TS 客户端调用方式、执行默认值、审批、Context 顺序和 Runtime 安装依赖；发现合同差异先补 parity 测试。 |
| 自动行为依据 | 首次消费补齐调用身份、ACK 查询和原流恢复沿用 TS KernelClient；不新增业务 retry 或服务 launch。 |

Issue 明确授权的 `native/` 客户端是 Kernel 的外部消费者，不把 Go/Rust/Python 工具链、pywin32 或客户端依赖加入 TS Runtime 的生产依赖或 npm 安装流程。实施时在架构规则中澄清该边界，不能借客户端需求引入公共进程监督二进制。

## 关键合同

1. 数据权威源只在 `packages/octo-runtime-protocol/schema/`。开发时生成 wire 类型、编解码与校验、错误目录、八个 RPC wrapper、高层 invoke/恢复/取消/登记代码。生成文件入库，模板与共享行为合同一起评审；手写层只提供语言异步机制和平台 I/O。
2. 保持 IPC v1、Run 7、Context v3、Adapter transport 2。补齐描述不等于变更 wire。若发现必须改变现有合法行为，先登记差异、影响和迁移条件，再更新设计，不能静默升级或放宽权限。
3. `invoke` 在首次消费时登记、补齐原身份并 submit/subscribe。提交后 ACK 丢失只查询原五元组和 instance，原 invoke 写出次数始终为 1。
4. 续流必须携带完整 RunRef 和最后连续 seq，保留窗口/次数/时间预算；Kernel 重启、代次不符、缺口或窗口失效明确失败。
5. 取消信号和 deadline 映射为明确 cancel。cancel ACK 不代表终态。关闭观察、迭代器、客户端或语言任务不隐式取消 Run。交互和控制结果未知时不自动重发副作用。
6. 原生 payload 与未知可选扩展保留；省略、null、空字符串、空数组、false、0 分别处理。已识别必填、权限、身份、数值和 tagged union 继续校验。
7. 三语言必须各自完成 macOS/Linux UDS 和 Windows pipe 的真实 Kernel 互通。缺少平台或真实 Provider 证据记为待验，不能以交叉编译代替。

## 交付物与实施顺序

| 产物 | 说明 |
| --- | --- |
| [design](design.md) | 源码差距、八方法映射、生成边界、语言 API、状态机、数值/字节及版本合同。 |
| [plan](plan.md) | M0-M7 依赖、逐文件动作、可运行目标命令、失败处理与发布边界。 |
| [acceptance](acceptance.md) | A01-A40 断言、故障注入、证据、三语言乘三平台矩阵及 issue 覆盖。 |
| [assessment](assessment.md) | 96 分口径、剩余风险和进入实施的门槛。 |
| [context](context.yaml) | 实际读取依据、基线、授权和本轮检查。 |
| [contract-diff](contract-diff.md) | 已实现方法/输入字段及未闭合合同审计。 |
| [implementation](implementation.md) | native 内三语言 demo、逐项证据与跨平台/压力缺口。 |

按 `M0 合同冻结 → M1 生成器 → M2 共享联调器 → M3 Go → M4 Rust → M5 Python → M6 跨平台/包外/真实联调 → M7 回归与交付检查` 推进。每阶段具有独立退出门槛；三个 SDK 不能只靠 Go 的结果代验。

## 范围外

不实现 Fleet、expert/team 调度、LoopDaemon 及其发行，不引入 FFI 执行引擎或动态库，不重新实现 AgentExecutor，不持久化 Run 历史，不新增远程 TCP/HTTP/WS 网关，不自动安装/启动/重启 Kernel，不自动重试业务执行，不扩大 Provider 原生交互权限。包发布、Git commit、push、PR 和 merge 均未在本轮授权。

## 验收总门槛

A01-A40 全部可追溯；所有三语言必测平台格子有真实证据，任何必测 skip 不算通过；生成两次字节一致且 CI 拦截漂移；三个包在仓外安装/编译并无 Node 客户端环境下调用既有 Kernel；TS 现有回归保持。真实 Provider 联调与 fake Provider 自动化分别记录。具体命令和证据格式见 plan/acceptance。
