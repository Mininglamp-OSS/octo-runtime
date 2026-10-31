---
type: Task
title: "Issue 263：七天执行预算与独立无响应检测"
description: "公共单次调用默认 24 小时、最大七天，支持 72 小时健康执行并保留取消与清理合同。"
tags: [invoke, protocol, schema, context, testing]
timestamp: 2026-11-01T00:00:00Z
status: awaiting-verification-review
implementation_baseline: 0bcd89c528018ffd508ca8099c8ac9c6b88de35d
---

# 目标

解决健康调用被入口默认 120 秒总期限中断、显式 72 小时预算又被公共协议拒绝的问题。
宿主仅使用公共 API，经 Context、InvokeInput、Kernel IPC 发起一次持续调用；无需修改 Runtime 内部、拆分调用或重放任务。

来源：[GitHub Issue 263](https://github.com/Mininglamp-OSS/octo-runtime/issues/263)、Loop ORT-82 分诊评论 `18d1e20f-dea9-4a4f-a0e3-927217ef9ec4`，以及用户本轮决策“上限7天，默认值24H”。
本文为待审查规格，未表示实现或验证已完成。

## 已确认决策

| 项目 | 合同 |
| --- | --- |
| 默认整轮预算 | 24 小时，即 `86_400_000` 毫秒 |
| 最大整轮预算 | 7 天，即 `604_800_000` 毫秒，包含上界 |
| 最小整轮预算 | 保留既有 `100` 毫秒，包含下界 |
| 数值类型 | 有限安全整数；拒绝零、负数、小数、字符串、null、非有限数及越界值 |
| 72 小时调用 | 显式提交 `259_200_000` 毫秒，默认 24 小时本身不满足 72 小时任务 |
| enforcement | 保留默认 `enforce` 和现有 `observe` 语义；本任务不增加无限预算或单独关闭总期限的开关 |
| 其他检测 | 保留首帧、模型空闲、工具空闲、可选工具总时长及取消宽限的既有范围和策略 |
| CI | 范围不变；新增专项只在本地或显式手动执行 |

## 产品意图与责任归属

- 业务目标是让正常推进的本地任务连续完成；任务需要多长预算由宿主明确决定，Runtime 负责公共校验、默认值、计时及取消。
- 显式输入仍为 `runtimeLimits.runTimeoutMs` 或 `octo.execution/limits.payload.run_timeout_ms`。默认值是本次用户明确批准的通用执行合同，适用于经公共 Core/Kernel 入口且未显式指定整轮预算的调用。
- 合同内动作：校验并传递预算，使用单调时钟监督真实进度，在期限到达或显式取消时进入既有终态和清理流程。
- 越界动作：按业务类型猜预算、自动续期、重放 invocation、替宿主决定会话恢复、持久化业务历史或接管宿主数据库。
- 其他接入产品：SDK/CLI 的未指定整轮预算由 120 秒或 Core 的 3 小时统一为 24 小时；已有显式预算保持原值。Gateway、WeCom 自有配置的默认值、上限和重试总预算保持既有策略。

## 关键合同

### 公共输入与默认值

1. 同步修改 JSON Schema、Context 运行时校验、RuntimeLimits 运行时校验，统一整轮范围为 `100..604_800_000`。不机械放宽 tool、first-frame、idle、cancel 等其他数值上限。
2. Context v3、Run v7、内部 Adapter protocolVersion 2 和 Kernel IPC v1 保持不变；不新增字段或历史格式兼容层。
3. `prepareInvokeInput` 的入口默认与 `DEFAULT_RUNTIME_LIMITS.runTimeoutMs` 都采用 24 小时。直接 Core、Kernel worker 和 Adapter 看到的有效预算一致，不能因输入路径不同恢复为 120 秒或 3 小时。
4. 保留当前优先级：顶层 `runtimeLimits` 存在时整体选用；缺省时使用 Context 解析结果。顶层对象只指定其他字段或为空时，缺少的 runTimeoutMs 由 watchdog 默认补成 24 小时，不新增与 Context 的逐字段合并。原有 Context 校验和合法性要求继续有效。
5. 用户 Context 中显式的 limits 项按既有 Context 合并合同解析；没有 run_timeout_ms 时最终仍为 24 小时。不得修改调用方的输入快照。
6. 显式较短预算仍在其期限到达时取消；不能把 24 小时视为强制最小值。
7. 从 Schema 重新生成 TS 与 Go/Python 校验产物及 hash；新鲜度检查与共享边界样例一致，不手改生成文件。

### 监督与期限

1. 总期限为 watchdog 开始时间加有效 runTimeoutMs；进度只刷新相应 idle 时间，不延长总期限。
2. 健康进度在配置为 72 小时或七天时可以跨越 120 秒和 24 小时；总期限前 1ms 不取消，恰到期限请求取消。总期限与其他检测同时到期时保留既有总期限优先规则。
3. 24 小时默认调用在默认期限恰到时取消；“超过 24 小时不取消”只适用于显式更大的有效预算。
4. 配置长总预算后，首帧缺失、模型停滞、工具无进展仍可分别触发既有错误；模型 idle observe 不关闭整轮/工具检测，整体 enforcement observe 仍沿既有行为。
5. 人工等待、工具活动、模型进度均不豁免总期限。保持现有暂停 idle 与恢复计时行为。
6. 七天小于 Node 单次 timer 的有符号 32 位毫秒上限；不得把天数或秒误传入毫秒字段，也不得截断、取模或将预算隐式缩短。

### Adapter、诊断与生命周期

1. DSH 的 `session/wait` 接收有效整轮预算，缺省回退统一为 24 小时；核对实际锁定 SDK 对七天值的接受及调度。优先复用公开 SDK 的既有 timeout 参数和取消机制；不得修改依赖包源码或换回旧传输实现。若 SDK 本身拒绝或缩短预算，记录为阻塞，不能宣称验收通过。
2. DSH 初始化、普通请求、版本探针、shutdown 的独立有限预算不随整轮预算放大。
3. 公共失败详情须保留合法长预算的 `timeoutMs` 和 watchdog 时间证据，覆盖七天期限以及超期后回调延迟导致的 elapsedMs 大于七天。时间证据采用非负安全整数校验，不再用 24 小时截断；计数等非时间字段沿用各自既有过滤策略。保留既有公开错误码、脱敏与诊断白名单，不因范围扩大透出任意对象。
4. 外部 signal、公共 cancel 控制和应用服务 close 可以在长时调用中请求取消，消费真实终态并按既有合同释放资源。取消 ACK 不等于执行完成，close 超时或未确认清理仍报告 incomplete。
5. 执行拓扑不变：宿主原生构造 Kernel，Kernel 监督内部 worker，worker 使用唯一 AgentExecutor 和 Adapter。Kernel/Extra/Core 所有权及 socket、子进程、iterator 的清理责任沿现行规则；不新增服务、进程或 API。
6. attached client.close、观察 iterator.return 和 socket 断开仍仅停止观察，不擅自取消已接纳 Run；应用所有者通过既有服务 close/调用登记排空机制结束所属调用。

## 实施范围

- Protocol：Schema、`src/index.ts`、`src/context.ts`、`src/failure.ts`、共享协议 fixtures 和生成产物。
- Executor Core：入口默认、watchdog 默认及就近合同注释。默认值尽量复用已有合适依赖边界下的常量；不为两个数值新建通用配置框架。
- DSH：等待调用预算、缺省回退及 SDK 边界验证。核查其他 Adapter 消费 runTimeoutMs 的路径，只修改确实阻碍本合同的逻辑。
- 文档：InvokeInput 规则、受影响 Core/Kernel/SDK 中英文接入说明及示例，明确默认 24 小时、最大七天、72 小时显式覆盖与原有优先级。
- 在本任务目录记录实现、双轴 code-review 处置和验证版本、命令、结果；按仓库要求更新索引及可复用规则。

## 范围外

不新增无限执行、自动续期、持久执行/断电恢复、重启后继续 Run、无界输出缓存或流窗口扩容；不改变渠道策略、Provider 会话约束、宿主部署和数据库；不升级与需求无关的依赖；不扩大 GitHub CI 或默认测试范围。本阶段不授权实现、提交、推送、发布或合并。

## 验收

新增专项拟放在 `test/manual/263-long-running-invocations.mjs`，由显式命令运行，不进入默认 glob、scripts、CI steps 或必需状态。共享新边界场景放在手动专项的本地 fixtures；若更新已有共享 fixture 的原最大值样例，只替换原样例预期，不通过新增自动扫描用例变相扩展 CI。

| ID | 场景 | 可观察通过条件 |
| --- | --- | --- |
| A1 | 两种公共预算字段 | Context 与 RuntimeLimits 的 Schema/运行时校验均接受 100、24h、72h、7d，拒绝 99、7d+1 和非法类型；TS/Go/Python 编解码一致 |
| A2 | 默认与优先级 | 无 limits、空/部分顶层 limits、部分 Context limits 都最终默认 24h；显式短预算、72h、7d 保真；顶层整体优先于 Context；输入对象未变 |
| A3 | 公共 Kernel 路径 | 使用真实公共 KernelClient.invoke 和本地 IPC，经 Context 与顶层分别提交 72h/7d，以 fake Adapter 回读实际预算并得到合法终态；越界请求被拒绝且不启动 Provider |
| A4 | 长时间健康运行 | fake clock 下持续真实模型/工具进度跨越 120s、24h；72h/7d 期限前 1ms 未取消，恰到期限 run_deadline 只触发一次，进度不续期 |
| A5 | 默认和短期限 | fake clock 下默认 24h 及合法显式短预算在边界恰到时取消；人工等待和并发工具不绕过总期限 |
| A6 | 独立停滞检测 | 在 72h/7d 总预算下分别触发 first_frame、model_silence、tool_idle；覆盖 modelIdlePolicy observe、总期限并发到期与既有整体 observe 行为 |
| A7 | 取消与关闭 | fake-clock 长时状态下显式取消和 Core shutdown；真实 Kernel/宿主服务 close 的 fake Provider 集成确认终态、登记释放、timer/子进程回收，incomplete 不报成功 |
| A8 | DSH | fixture 与实际锁定 SDK 证明 24h 默认、72h/7d timeout 透传及调度不被缩短，取消和关闭正常；不等待真实 72h，不以只断言常量代替 SDK 边界证据 |
| A9 | 长时错误详情 | 七天总超时及超期延迟的 elapsedMs 经公共 failure 转换仍可读，错误码和其他字段过滤保持有效 |
| A10 | 生成与交付边界 | 生成检查通过；相对基线的 workflow diff 为空，默认 scripts、glob、测试开关和实际检查列表无扩展；文档与实现一致 |

fake-clock 测试复用 InvocationWatchdog 的时钟注入模式，按时间顺序执行应到期回调并注入真实进度，不能只跳变时间后读取未触发的 timer。跨进程接纳/清理使用真实本地 IPC 和 fake Provider；长时计时在可控时钟层验证，两类证据组合覆盖路径，不承诺把操作系统时钟快进七天。

### 检查命令与结果记录

- 规格阶段：`python3 .octospec/scripts/lint.py`、`git diff --check`，仅校验文档。
- 实施后：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm test`（既有范围），再显式执行新增手动专项。
- 生成验证：`pnpm --filter @mininglamp-oss/octo-runtime-protocol gen`、`node native/codegen/generate.mjs --check`；若需更新 native 则先运行生成命令。Go/Python 新边界测试显式手动执行，记录确切命令及环境。
- 实施前核对 `.octospec/guides/provider-live-acceptance.md`，对受影响 DSH 做独立真实短调用/取消验收，记录 SDK/Provider 版本；不请求真实模型持续 72 小时。
- 真实宿主应用及 im-test 注册/调用检查按仓库现行要求执行；环境不可用则标注 blocked/not run，不用本地 fixture 冒充线上通过，不因此扩大 CI。
- 结果绑定 SHA、dirty 状态、操作系统和依赖版本；通过、失败、未执行及原因分别记录。任何必要验收失败或缺失都不报告实现验收完成。

## 决策与可执行性审查

阻塞产品决策：无。上限七天、默认 24 小时已由用户确认；有限预算、既有优先级及渠道范围沿分诊建议收敛。

实施核对项：锁定 DSH SDK 的 timer 行为、failure 时间字段的精确映射、真实宿主环境可用性。均有上述具体处置和验收，不要求用户预先指定实现细节；发现合同无法兑现时返回规格审查。

可执行性自评 **97/100**：范围与归属 20/20、输入/默认/边界 25/25、实现路径 18/20、验收可观测性 25/25、风险与恢复 9/10。余项来自 DSH SDK 边界和真实宿主环境，必须在实施验证中给出证据。

## 开发环境

基线 `origin/main@0bcd89c528018ffd508ca8099c8ac9c6b88de35d`；分支 `fix/263-long-running-invocations`；worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-263`；主机 `lvsijiaMacBook-Pro.local`。

规格阶段只创建本文及规则阅读记录。审查通过后由 `start-implement` 进入实现，实际提交与推送仍需已有明确授权。

## 实施进度

用户已通过“开始实现 顺便修复 frontmatter问题”授权实施及四份文档元数据修复。实现、本地验证与双轴审查已完成，证据及未验边界见[验证记录](validation.md)；当前等待验证审查，未获提交或推送授权。上述预算、范围与验收决策保持不变。
