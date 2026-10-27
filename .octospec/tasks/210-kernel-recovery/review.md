---
type: Review
title: Issue 210 verified-review 与修复记录
timestamp: 2026-10-27T00:00:00Z
---

# Verified Review

状态：通过。逐文件阅读、故障注入及发现修复完成，无剩余 medium 及以上发现。
用户已授权实施、审查修复、提交 PR 和 Loop 评论。

## 范围与基线

审查 `codex/issue-210-kernel-recovery` 的 HEAD 与全部本地修改、未跟踪任务和测试文件。
基线为 `005116ec7a28e27ccaddde75057e6289cfb549a5`，dirty=true；macOS / Node.js 24.19.0。
已 fetch main，未发现基线之后的新提交。生成文件只检查 schema 来源、生成一致性和运行验证，
不逐行审查生成的规则编号。无 `.opencodereview/rule.json`。

## 审查计划

1. 跟踪 supervisor、process、manifest 的实际资源与关闭顺序：失败后真实重试、单路替换、
   PID 复用保护、共享关闭期限、启动回滚清理、成功后不再次发送历史信号。
2. 跟踪 Kernel server/client 的拒绝边界和 Gateway 分类：真实接纳前证明、instance 校验、
   不把已接纳失联变成未提交、不自动重放旧请求。
3. 逐个核对日志写入、白名单、读取预算、CLI 路由、follow 取消、schema 和双语说明。
4. 逐个读取新增/改动测试与 Codex 夹具，并运行真实本地 Kernel IPC 的失败注入，验证
   故障解除至新请求完成的耗时、持续失败与关闭竞态，不用退出码替代实际状态断言。
5. 候选发现按证据等级过滤；修复后复跑同一复现和另一调用方，再给出最终未解决项与覆盖范围。

规则映射：所有路径遵守用户指令和 AGENTS；Kernel/SDK/CLI 遵守 architecture、
local-execution、runtime-lifecycle、engineering；schema 遵守 protocol-schema；
拒绝反馈与渠道测试遵守 channel-integration；任务与提交遵守 collaboration，但 OSS
commit/PR 英文要求以用户指令为准。

## 已修复发现

### Medium：父日志串行关闭使正常资源回收误报超时

位置：`packages/octo-runtime-executor-kernel/src/server.ts:432`，类别 bug，证据 reproduced。
审查前新增的 `await attempt(() => logging.close());` 放在 worker 与 Run 清理之后，
会在共享 5 秒期限内再消耗最长 1 秒日志关闭时间。worker 已安全停止但确认较慢时，
服务会返回 complete=false，使调用方保留所有权并阻塞后续生命周期操作。

回归使用真实 Kernel/worker，将实际 worker 清理后的确认延迟 4400 毫秒，父日志关闭
延迟 1000 毫秒。修复前 5057 毫秒返回 incomplete，期望为资源已清理且 complete=true。
修复后父日志与 worker 独立清理重叠，4472 毫秒返回 complete=true。

当前代码摘录：

```ts
const loggingClosed = attempt(() => logging.close());
const workerStopped = await attempt(() => worker.close(until - 200));
await attempt(() => runs.close());
await loggingClosed;
```

### Medium：Kernel 日志读取给损坏记录伪造当前时间

位置：`apps/cli/src/logs.ts:26`，类别 bug，证据 reproduced。
审查前 Kernel 分支直接调用 `kernelStatusRecord(value.level, value.event, value.data, value.time)`。
缺少 time 的磁盘记录会触发写入 helper 的默认时间，变成一次新的、看似有效的恢复事件；
Extra 分支已拒绝同类记录。这会污染故障时间线。

回归向独立状态文件写入一条合法记录和一条缺 time 的记录，期望只输出一条。
修复前实际输出两条；添加时间字段类型检查后输出一条，text/NDJSON 使用同一读取入口。
当前代码摘录：

```ts
return value.source === "kernel" && typeof value.time === "string"
  ? kernelStatusRecord(value.level, value.event, value.data, value.time)
  : undefined;
```

两项修复的同一复现命令：

```sh
node --test --test-name-pattern 'Kernel logs reads|parent logging closes' test/kernel-recovery.test.js
```

修复前两项均失败，修复后两项均通过；后续全量覆盖普通关闭、Extra 日志及其他调用方。
无 critical/high 发现。剩余候选按实际所有权、调用方和失败分支核对，没有保留未证实猜测。
最终 Node 全量 2022 通过、56 跳过、零失败，WebUI 35 通过；Codex 模拟 5 项通过；
Go/Python 各 358 条共享样例通过，完整 build/typecheck、lint、命名和文档检查通过。

## 覆盖

共 42 个变更文件。38 个人工逐文件审查，4 个生成产物按输入和运行一致性检查：
`src/generated/protocol-types.ts`、Go/Python 生成文件、`native/generated-manifest.json`；
未逐行审查 Go 生成器重排的规则编号。没有二进制、锁文件或大于 1500 行的单文件改动。

逐文件覆盖记录如下，各条中的文件均单独读取对应 diff 或完整新文件：

- Kernel：process、supervisor、manifest、server、service、client、submission-error。
  核对失败缓存、真实重新清理、PID 复用、启动回滚、关闭期限和接纳证明。
- Adapter SDK：index、runtime-log、runtime-log-worker、service-status。
  核对公开导出、父日志所有权、有界队列、轮转、状态字段白名单与异常正文隔离。
- CLI：command-tree、main、logs、output。核对配置解析前路由、只读目录、读取预算、
  follow 轮转和取消，以及运行状态与执行就绪的差别。
- 协议：schema、shared fixtures、failure、run-protocol.test。
  核对可选字段兼容、严格诊断结构、真实响应证明与任意同名错误的区别。
- 测试：kernel-recovery、extra-status-logs、im-pre-execution-failure。
  核对真正执行新请求、同一 Kernel 身份、旧请求 unknown、无自动重放和持续阻塞行为。
- 本地 Codex 模拟：codex-worker、codex-app-server、reproduction.test。
  使用真实 Adapter 和本地 app-server 协议 fixture，确认独占资源范围和 finally 清理。
- 文档：双语 CLI、OKF index、三条修改规则、brief、design、assessment、validation、
  context、journal、本 review。核对基线与修复行为、用户授权、实测时间及未验证边界。

## 运行边界

实际运行结果见 [validation.md](validation.md)。未验证 Windows 真机、真实 Codex 工具后代
在强杀场景的完整回收、线上 IM 与真实模型；本地 fixture 成功不替代这些验收。
原事故退出原因仍未知。本次没有操作用户真实 Home 或改变部署。
