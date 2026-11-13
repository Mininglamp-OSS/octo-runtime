---
type: Task
title: ORT-95 模型持续静默周期通知
description: 在同一公开文本静默区间每隔六十秒发送新通知，保留有界交付与执行预算。
tags: [runtime, architecture, canonical, stream, testing]
slug: ort-95-periodic-model-output-idle
source: ORT-95
---

# 先看变化

这是对现有一次性提醒的功能增强（feature），不是声称现有实现违反旧合同。当前合同本来规定每段静默只提醒一次；本需求改变这一行为。

| 场景 | 变化前 | 变化后目标 |
| --- | --- | --- |
| 模型连续三分钟没有新的公开文字，且消费者持续读取 | 第一分钟通知一次，卡片停在“模型已 60 秒无输出” | Runtime 在 60、120、180 秒各发一条新通知，Gateway 每条刷新原卡片 |
| 第一条通知因网络延迟，到第 80 秒才被 Gateway 收到 | 展示源报告的 60 秒 | 仍展示 60 秒，不能加上网络延迟；下一节点仍以源端静默起点计算 |
| 第 130 秒模型说了新话，之后再次安静 | 新段满 60 秒可提醒一次 | 新段在总时间 190、250、310 秒等节点继续周期提醒，报告新段的 60、120、180 秒 |
| timer 应在第 60 秒触发，实际到第 190 秒才运行 | 一条约 190 秒的通知 | 一条约 190 秒的通知；下一节点为第 240 秒，不追发 60/120/180 秒三条历史通知 |
| Runtime 已超时、取消或收到终态 | 执行按原策略结束 | 原策略仍优先，不能为了凑齐周期提示而继续执行 |

本文是待审查规格，尚未实现。功能验收结果在实施阶段单独记录。

## 目标与来源

- 任务：ORT-95；原始需求见 [GitLab issue 1](https://codex.mlamp.cn/dmwork/octo-component/octo-runtime/-/issues/1)。
- 分诊结果：Loop 评论 `9e785040-23c1-43ba-bb68-9a47ac348f83`。用户本次命令为“开始写 spec”。
- 消费端：ORT-93 / [Gateway issue 16](https://codex.mlamp.cn/dmwork/octo-component/octo-channel-gateway/-/issues/16)。周期能力是消费端规格的 U1 依赖。
- 本阶段重新执行 `git fetch origin main`，HEAD 与 origin/main 均为 `8376be620647f50ef50741a2a6f69c3a1e03a395`，无须 rebase。
- Worktree：`/Users/lvsijia/codex.mlamp.cn/dmwork/octo-component/octo-runtime-ort-95`；分支：`feat/ort-95-periodic-model-output-idle`；主机：`lvsijiaMacBook-Pro.local`。

## 架构归属检查

| 检查项 | 本需求的归属 |
| --- | --- |
| 业务目标 | 模型长时间无公开文字时，消费者能持续显示源端报告的静默事实 |
| 决定权 | Runtime 定义并产生周期事实；Gateway 决定卡片文案与投递，只消费事实 |
| 显式输入 | 沿用 canonical 模式及本轮有效执行预算；不新增调用参数、周期配置或渠道开关 |
| 合同内动作 | Core 基于单调时钟观察公开新增文本，在已有事件流发 notice；Kernel/client 保序传递 |
| 越界动作 | Gateway 自行计时/补算/取消；Core 因渠道调整周期或执行预算；通知改变业务会话或执行结果 |
| 其他接入产品 | 所有 canonical 消费者将看到同段更多 info notice；native 不实例化观察器，无新增 native 类型 |
| 服务拓扑与所有权 | 保持 HostApp → KernelClient/RPC → Kernel → AgentExecutor → Adapter；无新进程、服务或公共 API |

依据：[基础架构](../../rules/architecture.md)、[输出协议](../../rules/output-protocol.md)、[本地执行](../../rules/local-execution.md)、[有界状态](../../rules/stateless-execution.md)。

## 已确认要求

以下要求来自任务及已有有效合同，不重新发起产品选择：

1. 同一静默区间在正常消费时每经过 60000 ms 产生新 notice；源端计时归 Runtime。
2. 使用既有 JSON-RPC 2.0 `agent_run.event` 和 canonical `run.notice`。code 为 `model_output_idle`，severity 为 `info`；每条新通知 noticeId 唯一。
3. params 仅含 `silenceMs` 和 `message`。silenceMs 为源端测得的安全整数毫秒，至少 60000；message 严格为 `${Math.floor(silenceMs / 1000)}s no LLM output`。不新增协议字段或版本。
4. 真实公开新增文本重置区间；公开性与文本增长沿用 Core 的 prepareMessage 判定，不再维护第二份消息缓存。
5. 排队、工具执行、同步审批/输入等待暂停，最后等待解除后新起一段；async question 不暂停。
6. 已生成事实与未来区间分别维护；新文字或等待不能撤回已有 pending。终态、取消、源结束/异常和 dispose 则清除 pending 并停止观察。
7. 通知只报告事实，不控制执行；Watchdog 的首帧、模型空闲进度、工具、总预算及取消宽限保持。默认 enforce，显式 observe 的协议合法性不变。
8. 待发、监听和计时资源有界；不丢源结果，不并发 next，不积累每分钟通知队列。
9. 更新架构/行为文档及中英文输出契约。专项仅本地或显式手动执行，GitHub CI 范围不得扩大。

## 周期与时钟合同

下述为本次建议方案，规格通过后作为实现依据。数值示例均使用源端单调时钟，时间原点为本段起点。

- 初始起点保持为 Core 开始本轮 Adapter 调用时刻。公开新增文本在源 next 准备结果时立即重置起点，不等消费者恢复读取。
- 每段拥有独立身份、起点 `since` 与下一周期节点。段身份不得只用时间戳比较，以覆盖受控时钟同一时刻连续重置及迟到 callback。
- 节点固定为 `since + n * 60000`，n 从 1 开始。通知交付、Gateway 接收或订阅重建都不得重设 since。
- timer 运行时计算 `elapsed = floor(now - since)`。达到当前节点才产生通知；提前唤醒重新等待。实际 elapsed 可大于理想节点，不能伪造整分钟值。
- 产生通知后跳过已跨越节点，下一节点为严格晚于当前源端时间的整分钟边界。例如实际 elapsed 为 65432 时下一节点为 120000；为 190000 时下一节点为 240000。
- 源端恢复观察时，可以对尚未报告的已跨越节点产生至多一条当前实际时长通知；不得枚举补发历史节点。若尚未跨下一节点，等待原节点。
- 没有 Core waiter 时不保留活动 timer；恢复 waiter 后沿用原 since 和周期进度。这不改变 Kernel 已接纳执行独立于下游 socket 消费的合同。

### 背压的确定行为

本方案选择保留已生成通知的原始值，不在 take 或 Gateway 接收时按交付延迟改写。任务允许合并，不强制维护持续运行的后台合并 timer。

1. 每轮最多一个 pending notice。pending 已占槽时不启动下一 timer，不创建第二条后台通知；已经 yield 出去的对象也不再修改。
2. pending 保存所属段身份。普通输出或进入等待时保留 pending 的 noticeId、silenceMs、message，但重置/暂停未来段。
3. 取走仍属于当前段的 pending 时，将该段已经错过的节点标为跳过，下一次只等待严格晚于当前源端时间的节点。这样不会刚交付旧通知就补发另一条同段历史通知。
4. 取走旧段 pending 时不得推进或重置新段周期。先处理已经就绪的普通源结果；新段是否到期由自己的源时钟决定。
5. 同一段在背压恢复后至多产生一条恢复通知；两个不同段的真实通知不属于同段补发，但仍不能拖住已经就绪的源输出或终态。

| 源端时间线 | 恢复时结果 | 后续节点 |
| --- | --- | --- |
| 60 秒生成 pending；190 秒才 take，期间无新输出 | 交付原 60 秒事实，不把它改成 190 秒，不补 120/180 秒 | 240 秒 |
| 60 秒已交付，消费者停到 190 秒才再次等待，期间无新输出 | 重新监听后生成一条约 190 秒的新事实，不补 120/180 秒 | 240 秒 |
| 60 秒生成 pending；70 秒源端到达新文字；100 秒恢复 | 原 60 秒通知先于该普通文字交付；新段不能从 100 秒起算 | 新段总时间 130 秒 |
| 60 秒生成 pending；70 秒进入工具等待；190 秒取走 | 仅交付原事实，等待中不产生新通知 | 最后等待解除后满 60 秒 |

### 并发交付与清理

- 保留现有 readNext 在源结果就绪时准备消息、报告 Watchdog、更新静默事实的顺序。
- 已生成 pending 与普通源结果同时就绪时，无论 Promise.race 谁先完成，都先交付 pending，再交付原源结果；普通输出恰好先于 timer 完成重置时，则不凭空生成旧段通知。
- 每轮只有一个在途 Provider next。notice 唤醒不消费该 next，不丢弃其值或 rejection，不重复 prepareMessage，也不借周期 timer 并行拉取。
- 终态、源结束/异常、已生效的取消先于尚未 yield 的 pending；清理使 timer callback、wake 和旧 detach 不能恢复观察或清除新 waiter。
- 源错误、缺终态、非法事件及清理失败沿用当前诊断与结果，不能因通知背压伪装成功。
- 观察器最多一个 timer、一个当前 waiter、一个 pending；旧 listener 解除不得破坏后建立的 listener。重复注册/解除一万次后数量仍满足上限。

## 预算边界

公开文本静默与 Watchdog 模型空闲进度是两个口径。例如 usage 或某些 Provider 进度可以影响 Watchdog 的有效进度，但不能冒充公开新增文字。通知本身不能向 Watchdog 报告模型进度，不能延长首帧、模型空闲、工具或整轮预算。

周期测试用受控时钟推进，不把真实三分钟等待加入默认测试。Core 长序列 fixture 必须显式给足 first-frame、model-idle 与 run 等相关预算，保持 enforce，并先交付真实首帧；单测注入时钟不能意外改变产品默认值。另设预算边界用例，证明通知仍在发时 enforce 依旧按有效期限失败，其他预算先到仍优先。

## 实施范围与文档落点

| 位置 | 计划改动 |
| --- | --- |
| `packages/octo-runtime-executor-core/src/model-output-silence.ts` | 用段身份与周期进度替代永久 reported；维持单槽、唯一监听与清理；同步中文注释 |
| `packages/octo-runtime-executor-core/src/index.ts` | 核对源 next 与通知交付顺序；仅在实现上述合同确有需要时局部修改，不重构执行循环 |
| `test/manual/model-output-silence.test.mjs` | 修改一次性断言，加入周期与恢复边界，保留现有 race/source-outcome 覆盖 |
| `.octospec/rules/output-protocol.md` | 将每段一次更新为周期，写清单槽恢复、交付顺序和预算独立 |
| `.octospec/rules/architecture.md` | 补充静默时钟、事实生成归 Runtime；渠道只消费，预算独立 |
| `docs/en/reference/output-and-control.md`、`docs/zh-CN/reference/output-and-control.md` | 双语同步 60/120/180、迟到/背压与版本前提，删除当前行为的一次性表述 |
| `docs/en/concepts/architecture.md`、`docs/zh-CN/concepts/architecture.md` | 同步开发者架构责任边界，沿用既有章节结构 |
| 本任务目录、journal、知识目录 | 实施阶段记录实际验证、审查与已生效合同；不改写历史任务证据 |

协议 Schema 已允许合法大于 60000 的时长，本次不计划修改 Schema、生成类型或 client API。若实施发现确实需要协议变更，先记录原因并回到规格审查。

范围外：Gateway 业务实现、版本发布、npm/tag、运行中服务替换、全局 CLI 安装、提交、推送、PR/MR、合并和其他 Provider 重构。真实测试只使用独占测试实例，不擅自重启用户服务。

## 验收矩阵

下列均为计划，当前状态为未执行。受控用例验证 Runtime 行为；真实端到端验收单列，不互相替代。

| ID | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| A1 | 正常消费持续静默，推进到 59999/60000/120000/180000 ms | 阈值前无通知，三个节点分别新 notice；ID 互异、时长与 message 一致、事件校验通过 |
| A2 | 首次 callback 迟到 65432，再到 120000；另测一次跨到 190000 | 分别报告 65432/120000；跨越多节点只发 190000，下一节点 240000，无追发 |
| A3 | 130 秒真实公开输出后继续静默 | 新段 60 秒前无通知，之后每 60 秒通知；不沿用旧周期进度 |
| A4 | 空白、重复/缩短快照、状态补丁、usage、心跳、私有 reasoning、公开 summary 增量 | 仅 Core 确认的公开新增文本重置；保留现有消息身份与增长判定 |
| A5 | 重叠工具/排队/同步输入和审批；async question | 最后等待解除后新计 60 秒，异步问题不暂停；等待期间无新周期通知 |
| A6 | pending60 到 190 秒才 take；已交付60 后到 190 秒才 listen | 前者仅交付原60、下一240；后者至多新190、下一240；不从190重计满60 |
| A7 | pending 与源端新输出/等待竞态，含旧段 pending 与已到期新段 | pending 不被普通重置吞掉；不跨段修改值/周期；通知和所有真实源结果只交付一次，源结果不被连续补发拖住 |
| A8 | 普通源结果赢 race 与 notice 赢 race、延迟 wake | 已生成通知先于普通结果；真实输出总量/顺序保持、唯一在途 next、不重复准备消息 |
| A9 | notice 背压期间 completed、error、missing-terminal、invalid-event、取消 | 终态/错误保持原结果；未 yield pending 清除；清理后无 timer、wake、通知或新后台任务 |
| A10 | 一万次 listen/detach、旧 detach/旧 callback、同一时刻连续 reset | 最多一个 timer/waiter/pending，无 waiter 无 timer；旧 callback 不向新段注入通知，dispose 后数量为零 |
| A11 | enforce 模型空闲期限及首帧/工具/总预算先到的场景 | 通知不更新任何执行预算，按各自原口径超时；observe 既有合法性保持；长周期 fixture 显式足够预算 |
| A12 | 真实 Kernel RPC + 公开 client 订阅及恢复 | 复用 agent_run.event，合法身份/连续序号/重放保持；原帧重放保留原 noticeId，不重新计时或重复执行；多订阅不创建多个观察器 |
| A14 | native 模式与协议校验 | 不产生新的 native notice 类型；每条 canonical notice 通过现有 Schema/语义校验 |
| A15 | 文档、元数据与 CI 差异 | 中英文一致、当前合同无每段一次承诺；相对目标 main 无 workflow/job/矩阵/触发/status/Gate/默认专项选择扩围 |

## 实施与验证步骤

1. 规格获认可并收到“开始实现”后，在原 worktree 重新 fetch 核对 main。需要 rebase 时先记录工作区状态并保护本规格，不丢弃未提交内容。
2. 将周期状态、段身份、槽所属段与 timer 生命周期实现为局部状态转换；先完成 A1/A2/A6/A7 的受控回归，再覆盖等待与终态。保留现有 Core/readNext 保护。
3. 更新现有合同与双语文档，同步最近中文注释。使用 code-review 技能审查 Standards/Spec，修复有证据的问题并记录结论。
4. 按仓库锁文件安装依赖后构建，显式执行 `node --test test/manual/model-output-silence.test.mjs`；运行 `pnpm lint`、`pnpm lint:names`、`pnpm typecheck`、`pnpm test`、`pnpm docs:check` 和 `python3 .octospec/scripts/lint.py`。已有全量检查失败须定位，不能作为本任务通过；不把手动专项塞入默认命令。
5. A12 使用真实 Kernel/socket/client 路径配合受控 Provider 夹具验证传输，明确这是集成测试，不是实际渠道端到端证据。Gateway 实现及渠道验收由另一个项目承担，不作为本次 Runtime 验收或合并前置条件；原 A13 已按用户决定移除，其他验收编号保持不变。
6. validation 绑定源码 SHA、dirty diff、Runtime 构建元数据、client 实际解析版本/来源、平台、命令、逐项结果与清理事实；凭据及业务正文不得入库。
7. 实现或必需验证失败回到规格审查，由用户决定重试或调整。
8. 提交前核对 `git diff origin/main -- .github/workflows package.json` 及相关脚本/默认测试选择、目标分支实际检查列表。提交、推送、PR、发布、替换运行服务按后续明确授权执行。

## 待审查与外部依赖

| 项目 | 当前建议或事实 | 对后续的影响 |
| --- | --- | --- |
| D1 背压槽策略 | 建议保留已生成通知值，停止槽占用期间的 timer；take 后同段跳到未来节点；不在交付时改写为新时长 | 与已有“通知事实不可撤回”一致；背压期间展示允许落后。用户认可规格后按此实施，无需再做同一选择 |
| D2 跨段顺序 | 建议保留旧段 pending 先于普通源输出；新段时钟独立，终态/错误/取消仍清除 pending | 防止回归 PR352 的吞通知/源结果问题；A7/A8 锁定 |
| U1 真实渠道前置 | 需要 ORT-93 消费实现及具备周期能力的实际 Runtime 实例；当前未验证具备条件 | 不阻止编写/审查规格；完整功能验收不能缺省通过，不扩大授权替用户部署或发布 |

其他产品决策已在任务正文明确。D1/D2 是供本次审查的具体实现选择，不标成已获用户确认。U1 是环境/协作依赖，不以臆造版本号或发布承诺补齐。

## 可执行性自评

**96/100，仅为规划准备度，不是实现或测试通过结论。**

| 维度 | 得分 | 差距 |
| --- | --- | --- |
| 目标、责任与范围 | 25/25 | 要求及架构归属明确 |
| 周期、背压、并发合同 | 24/25 | D1/D2 具体方案仍待本次规格审查认可，扣 1 分 |
| 验收与失败路径 | 24/25 | 周期与 Core 生命周期联动尚须实际代码/受控回归证明，扣 1 分 |
| 执行环境与恢复依据 | 23/25 | ORT-93 与真实测试服务的可用版本/联调条件尚未验证，扣 2 分 |

本阶段仅交付 brief 与读取上下文。完成规格检查并将 brief 作为 Loop 评论附件上传后，进入“等待规格审查”；不自动开始实现。

## 实施授权与结果入口

以上保留 2026-11-13 规格审查时的规划记录。用户在 2026-11-14 发出“开始实现”，确认 D1/D2 并授权在原 worktree 实施。随后授权提交、推送和创建正式 GitLab MR → main，并明确 Gateway 由另一个项目改动，移除原 A13 必需验收。当前代码及验收状态见[验证记录](validation.md)，审查范围见[审查记录](review.md)。本次范围为 Runtime 周期通知，不包含 Gateway 实现、部署或合并。
