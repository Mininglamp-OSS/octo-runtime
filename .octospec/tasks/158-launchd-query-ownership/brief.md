---
type: Task
title: launchd 查询失败时保留服务定义与管理能力
description: 区分服务确认缺失与查询失败，避免停止和卸载误报成功。
tags: [runtime, lifecycle, installation, testing]
---

# 目标

用户执行状态查询、停止或卸载时，权限、会话、管理器和命令超时错误不能被解释成“服务已停止”。未确认旧 job 消失前保留 plist，让用户修复环境后能够重试。

来源：[GitHub #158](https://github.com/Mininglamp-OSS/octo-runtime/issues/158)、Loop ORT-57 分诊评论 `d36fcd56-2964-4300-9aee-addd187b9dc7`。用户已认可本规格并要求开始实现，尚未授权提交、推送或创建 PR。

## 基线与事实

- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-158`。
- 分支：`fix/158-launchd-query-ownership`；基线：`a5a32835882deab5e2364b559dd06bf1675c1335`。
- `launchd.ts` 与原报告基线 `8214292132d260c04cf72218580bef741788dd4a` 一致。`#print` 非零结果在 inspect/install/start/restart/bootout 中被当作缺失；停止轮询也存在同类误判。
- 原报告是注入命令响应的复现。本机只读原生探测观察到：已有 GUI 域下，缺失服务返回 exit 113，stderr 包含 `Could not find service` 和目标 label；print-disabled 成功返回 enabled/disabled 格式。
- 上述观察不证明原生权限故障已复现，也不证明真实残留进程已经出现。

## 关键合同

### 1. 服务查询分类

仅修改 launchd 用户服务后端，内部集中判定 `launchctl print gui/<uid>/<label>` 的结果；所有调用方复用同一判定。

| 查询结果 | 分类 | 允许的后续行为 |
| --- | --- | --- |
| exit 0 | 已加载 | 沿用现有状态解析和生命周期操作 |
| exit 113，且诊断明确为目标 label 的 `Could not find service` | 确认服务不存在 | 可执行对应缺失分支 |
| 其他非零、113 但无明确服务缺失诊断、域不存在、权限/会话错误、超时、runner 异常 | 查询失败 | 传播错误；不得推断缺失 |

缺失匹配须核对目标 label 的完整边界，不能只检查任意 `not found`、任意输出中的 label 子串或退出码非零。未知/本地化诊断按失败处理，宁可保留定义并要求排障，也不猜测成功。实现若发现原生证据要求增加另一缺失签名，先记录证据并更新规格，不能扩大为模糊匹配。

命令返回失败使用现有 `ServiceError("COMMAND_FAILED")`，保留 backend、command、exitCode 和有界 detail；runner 原有结构化错误继续传播，不统一覆盖成缺失。沿用现有 runner 的超时和无 shell 执行方式，不重试权限失败，不升级权限。

### 2. 查询与自启状态

- plist 存在，print-disabled 成功且服务查询成功或确认缺失时，沿用当前 `ServiceStatus` 结构；确认缺失时 state=stopped，enabled 由真实 disabled override 决定。
- 服务 print 查询失败时，inspect 抛出上述结构化错误；调用方获得 COMMAND_FAILED，不能获得伪造的 stopped。CLI 复用现有 catch，将服务状态显示为 unknown，并继续独立查询 IPC。
- print-disabled 任意失败同样抛出结构化错误，不能返回 false 并据此宣称 enabled=true。成功输出继续支持 true/false/ enabled/disabled；成功且目标没有 override 时沿用默认未禁用语义。
- CLI 对管理器查询失败的 fallback（state=unknown 且存在稳定错误 detail）显示 `autostart: unknown`，不能把兼容字段 enabled=false 渲染为已确认关闭。成功查询但无法识别进程状态时，真实 enabled 值仍可照常显示。
- 本次不改变必填 boolean `ServiceStatus.enabled` 或 JSON schema。CLI 既有错误 fallback 中的 enabled=false 是兼容占位值；state=unknown 与 detail 表示该快照不可用于判断自启。错误诊断不向 CLI JSON 输出原生 stderr 或凭据。
- inspect 自身不修改文件。失败时 plist 原字节保留；definitionPath 可从同一 spec 和后端路径规则恢复。本轮不新增所有权登记文件，也不扩展 ServiceError 携带状态快照。

### 3. 停止与卸载

- 首次查询确认缺失：stop 成功且保留已安装 plist；uninstall 可删除 plist。重复卸载在确认 job 缺失时仍成功，即使 plist 已不存在。
- 首次查询失败：不调用 bootout，不删除 plist，返回失败。查询不可靠时，盲目 bootout 不是验收要求。
- 查询确认 job 已加载：调用 bootout；命令失败保留定义并返回失败。
- bootout 被受理后，在原有有界预算内轮询；只有明确服务缺失才能确认卸载。查询失败立刻返回失败，持续加载直到预算耗尽则返回 COMMAND_FAILED，不删除定义。
- bootout 与查询之间的状态竞态不得吞掉其他错误；本轮不新增并发控制协议，沿用 CLI 组件 setup lock。
- 只有上述确认完成后 uninstall 才调用 removeDefinition。删除文件本身失败必须传播，不能报告成功。
- bootout 后查询失败时，job 可能已经停止，也可能仍在运行；错误只声明“无法确认”，不声称回滚成功或仍在运行。恢复查询能力后重试应可以完成。

### 4. 安装、启动和重启

- install 首次查询失败必须在写入/替换 plist、修改 enabled override 或 bootstrap/bootout 前终止；允许此前已发生的输出目录创建，不承诺文件系统零副作用。
- changed+loaded 的定义替换沿用当前写盘顺序；若随后 bootout 或轮询失败，保留当时磁盘上的 plist，不删除、不 bootstrap，不承诺恢复旧字节或撤销此前 enabled 修改。错误允许用户修复后重试。
- start/restart 的 print-disabled 或服务查询失败必须终止；不得用 bootstrap 作为查询失败的兜底。
- 确认缺失后的 bootstrap、已加载时的 kickstart、SERVICE_DISABLED 以及安装不隐式首次启动等既有语义保持。

## 实现范围

- `packages/octo-runtime-cross-service/src/launchd.ts`：集中分类、失败传播、所有生命周期调用点与轮询处理；就近中文注释解释为何不能把失败当缺失。
- `apps/cli/src/output.ts`：错误快照自启状态的诚实展示；仅在需要时补充调用方错误信息传递，不改 CLI 参数或退出码体系。
- 新增专项在 `test/manual/` 下显式运行，配套必要 fixture；现有 launchd fixture 只有 exit 113 而缺少诊断的情况需改为真实缺失响应，保持原测试数量和目的。
- 实现阶段按最终合同增量更新 runtime-lifecycle 规则与验证记录；不得将设计目标写成已测通过。

## 范围外

Linux/Windows 后端改造、权限提升、系统 LaunchDaemon、已遗失 plist 的自动修复、全机服务扫描、SDK 公共状态模型重构、Home/身份数据迁移、原生语言重写、后台服务自动部署，以及扩大 GitHub CI 范围。

## 验收

### 可观察场景

| 编号 | 场景 | 必须观察的结果 |
| --- | --- | --- |
| A1 | 已有 GUI 域，服务确认不存在 | inspect=stopped；stop 保留 plist；uninstall 删除 plist；再次 uninstall 成功 |
| A2 | print exit 5 / 权限诊断；或 exit 124 | inspect 抛 COMMAND_FAILED；stop/uninstall 失败；bootout 次数为 0；plist 字节不变 |
| A3 | GUI 域不存在；exit 113 无诊断；错误涉及其他 label | 全部视为失败，不删除定义，不尝试 bootstrap |
| A4 | print-disabled 失败 | inspect/start/restart 失败，不能当作 enabled=true；CLI unknown 且自启 unknown |
| A5 | bootout 失败 | 返回失败，保留 plist，不 bootstrap |
| A6 | bootout 成功，后续查询失败 | stop/uninstall 返回失败，保留 plist，不提前确认停止 |
| A7 | bootout 异步成功；或一直已加载 | 前者等到确认缺失再成功；后者有界超时且保留定义 |
| A8 | install/start/restart 遇到服务查询失败 | install 初始失败不写/换 plist、不改 override；start/restart 不 kickstart/bootstrap |
| A9 | 更换已加载定义后停止确认失败 | 保留磁盘定义，返回失败，不 bootstrap；不声称事务回滚 |
| A10 | 故障恢复后再次卸载 | 同一 spec 可完成停止确认和卸载；最终无测试 job/plist |
| A11 | 正常 loaded/missing 与四种 override 格式 | 原有行为回归通过，CLI 成功快照自启 on/off 仍准确 |
| A12 | 删除定义 IO 失败、runner 异常 | 错误传播，不能记录为卸载成功；保留可恢复信息 |

A2–A9 采用真实 LaunchdUserBackend + 注入 CommandRunner 精确控制响应，并断言命令顺序、次数及文件字节，不能只测内部分类函数。CLI 展示断言包含已有成功状态和错误 fallback。

### 原生 macOS 专项

使用每次运行生成的唯一 label、隔离 HOME/工作目录和最小长驻测试进程，不操作任何现有 Runtime 服务。正常流程使用真实 launchctl，记录启动 PID、stop 后 job 确认缺失和 uninstall 后 plist 消失。

失败流程可在已真实加载的测试 job 上注入 print/print-disabled 故障，验证失败时真实 job 和定义仍可通过原生 label 管理；另覆盖 bootout 已执行后查询故障，此时只要求定义保留且结果诚实。必须明确这是原生 job + 注入故障，不表述为真实权限拒绝复现。不为制造权限错误修改系统权限、账号或会话。

finally 使用保留的原生 label 清理测试 job，并确认进程退出后删除临时目录；清理失败记录 label/PID/路径，整体不报通过。无 GUI 域时记 blocked，不能用模拟测试代替原生通过。

### 命令与证据

实现后运行 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:names`；构建后运行现有 `node --test test/cross-service.test.js test/cross-service-failures.test.js test/cross-service-runner.test.js test/cli-lifecycle.test.js`。CLI formatter 相关既有测试按最终修改补充执行。

新增专项拟采用 `node --test test/manual/launchd-query-ownership.mjs`；原生专项 `OCTO_LAUNCHD_OWNERSHIP_NATIVE=1 node --test test/manual/launchd-query-ownership-native.mjs`。原生测试默认必须跳过且只由显式开关运行。最终文件名若调整，同步本 brief 与实际验证记录。

不将专项接入 package.json 默认命令、脚本自动发现或 workflow/job。交付前对比目标分支的 `.github/workflows`、默认测试入口和检查列表，确认 CI 范围未增加。绑定实际 SHA/dirty、OS/Node/launchctl 环境、命令、每场景结果与清理事实；通过/失败/blocked/not run 分开记录。

## 决策与待审查事项

- 已承接分诊决策：查询失败不能算停止，保留定义，确认缺失继续幂等；不扩大 CI。
- 本稿推荐决策：错误通过现有 COMMAND_FAILED 传播；inspect 失败不返回部分快照；不改变 enabled 类型，CLI 错误状态自启显示 unknown；缺失采用严格 113+目标服务诊断判定；定义替换不新增事务回滚。
- 需审查的具体取舍：严格缺失签名可能将未见过的 macOS 输出保守拒绝；JSON enabled 维持兼容占位值，由 unknown/detail 声明不可判断；真实权限错误采用注入覆盖，原生 job 路径另行验证。
- 无阻塞业务决策。认可本稿后可开始实现；若要求启用状态在 JSON 中直接成为 null/unknown，则需要另行调整公共状态合同及调用方范围。

## 可执行性自评

96/100：范围与失败边界 20/20，接口及兼容性 19/20，场景与断言 20/20，实现落点及验证命令 19/20，原生验证与恢复 18/20。扣分来自跨版本缺失诊断和真实权限故障证据尚不完整，已通过严格拒绝和明确验收限制控制。该分数表示规格准备度，不表示实现或验证通过。

规格自评不代替验收。实现阶段的实际结果与未验边界见 [验证记录](validation.md)。
