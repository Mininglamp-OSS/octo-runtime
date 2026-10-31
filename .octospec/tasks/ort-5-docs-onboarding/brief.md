---
type: Task
title: "ORT-5：docs 双语上手路径补齐"
description: "沿用现有文档风格，补齐 CLI、SDK 和 Gateway 最小路径，统一恢复说明及验证证据。"
tags: [documentation, runtime, installation, extra, context]
timestamp: 2026-11-01T00:00:00Z
---

# 目标

让用户仅沿 `docs/` 的英文或中文阅读路径，完成第一次 CLI 执行、SDK 调用或 Gateway 接入，并能判断结果、错误和关闭状态。保留现有目录、技术边界和文档风格，增量补齐缺失步骤及矛盾说明。

来源：GitHub Issue #15、Loop ORT-5 分诊修正评论 `65971e20-b084-4fe7-b0e4-b69e0c05db78`，以及用户“只管 docs 里的”“基于最新代码”“尽量风格语气保持一致；开始写spec”。原 Issue 的完整仓库文档重整不属于本次范围。

## 基线与阶段

- 编写规格前已 fetch 并将原分支 rebase 到 `origin/main@c35b261b31573bc2f08a16eeced12f18705b2560`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-ort-5-docs`；分支：`docs/ort-5-oss-onboarding`。
- 最新 PR #274 已修正双语 SDK 的 `attachKernel({ endpoint })` 及共享订阅预算说明，本任务保留并复核，不重复整改。PR #273 更新 Provider 所有权说明，本任务按其当前合同编写。
- 本阶段仅产出本 brief 和读取记录。产品文档、示例及验证结果尚未修改；未执行构建、模型调用或真实 IM 验收，未获提交、推送、发布或合并授权。
- 本目录是任务规格产物，不是对工程知识体系的整改。实现变更限定 `docs/`，不更新其他规则、索引、根指南或贡献政策。

## 已确认决策

| 项目 | 要求 |
| --- | --- |
| 整改范围 | 只处理 `docs/` 内的文档和直接服务这些路径的共享示例 |
| 结构与语气 | 沿用当前目录、页面标题风格、术语、短段落、命令块和表格；不另建站点或重写整套文档 |
| 中英文 | 同一变更更新配对页，代码共用 `docs/examples/`；导航、前置条件及验证含义一致 |
| CLI 首次运行 | 使用现有 `playboard` 完成一次临时执行；明确无需先安装或启动持久 Kernel，不改变服务管理默认行为 |
| SDK 首次调用 | npm 消费者先连接已有 Kernel；需要宿主自行拥有服务时，使用真实公开 Adapter 的完整创建示例 |
| Gateway | 通过公开 `createExtraService` 注入配置与依赖；宿主不操作内部 Bot、连接或队列 |
| maintenance | 保留历史版本及结果，分别说明初始验证和本次复核；不得把日期直接换成今天并沿用旧的通过结论 |
| CI | 复用现有检查，不增加 workflow、job、步骤、矩阵、默认测试入口或必需状态 |

## 产品意图与责任归属

1. 用户需要的是能照做的文档。现有断点由文档的顺序、占位示例和说明冲突产生，修复位置是 `docs/`，不要求修改 Runtime。
2. HostApp 选择安装、Provider、配置来源、凭据及业务数据；SDK 消费已经准备好的值。示例中的环境变量读取只属于示例宿主，不新增 SDK 配置约定。
3. 调用方显式传入 endpoint、Adapter、输入及本轮 Context。文档不得暗示 Runtime 自动登录、安装 Provider、恢复历史或重放任务。
4. Kernel 服务在调用进程原生构造，内部 worker 隔离执行；Extra 只连接指定 Kernel。attached client 只拥有连接，关闭它不关闭 Kernel、不自动取消 Run。
5. CLI 是一种 SDK 宿主。阅读顺序调整不改变其他 HostApp 的部署方式、服务默认值、会话或执行策略。
6. 所有自动动作和重试都描述当前实现，不借文档补齐之名新增行为。发现运行时缺陷时另行记录，不在本任务顺便修复。

## 关键合同与修改范围

### R1：保留现有风格与入口

- 默认不新增主题目录，不搬迁或删除现有页面。修改 `docs/{en,zh-CN}/README.md` 的阅读顺序和链接说明即可。
- 读者先选择 CLI 或 SDK，再在对应路径完成必要的 Provider 准备；无需先阅读完整架构、所有 Provider 或高级运维。
- 沿用现有章节、专有名称和语气。新增内容以“做什么、命令、预期结果、下一步”组织，不增加营销文案或内部执行日志。
- 本任务产生的日期、验证说明和未执行项集中在 `maintenance.md`，不散布到每个入门页。其他页面只写必要前置条件和失败含义。

### R2：CLI 首次执行先于服务运维

在 `docs/{en,zh-CN}/getting-started/cli.md` 内调整顺序，复用现有请求 JSON 和 `playboard` 说明：

1. 说明 Node.js `^24.0.0 || ^26.0.0`、安装 Runtime、准备并认证所选 Harness。首例继续使用 Codex，不要求安装所有 Provider。
2. 将 `octo-cli` 单独放在需要 Octo 业务工具的可选步骤，不能使普通本地问候请求看起来必须安装或配置它。
3. 在持久 Kernel、Extra 配置、日志和系统自启之前给出完整 `request.json` 与 `octo-runtime playboard < request.json`。说明运行目录、文件位置及必要参数；不以 `/absolute/...` 占位路径代替本例缺失步骤。
4. 写明成功标准：输出为 canonical NDJSON，实际成功终态是 `run.completed`；问候/OK 文本由 Provider 生成，不承诺模型逐字返回固定文本。列明 `run.failed`、`run.cancelled` 或交互请求不能视为成功。
5. `playboard` 使用临时 Kernel、不连接持久服务、不加载 Extra，结束时回收自己创建的资源。再引导需要常驻/IM 的用户进入既有服务 `start/status/stop/uninstall` 路径；保留 start 自动安装、自启等现行语义。
6. 常见错误就近简短说明并链接现有排障页，不把完整恢复说明复制到快速路径。保留 `--help` 检查和源码构建作为备用路径。

### R3：SDK 的 npm 路径可以独立照做

修改 `docs/{en,zh-CN}/getting-started/sdk.md`，复用 `attach.mts`、`invoke.mts`、`service.mts`、`dsh-service.mts` 和 `dsh-worker.mts`：

- **连接已有 Kernel**：给出新建独立消费目录、npm 安装主包、取得实际 endpoint、运行示例的完整步骤。明确通过 `status --json` 中的实际 Kernel endpoint 字段定位，编写时对照 CLI 输出；不能猜测平台路径。注明 shared `.mts` 文件如何取得及其 `invoke.mts` 依赖，或者提供完整等价单文件，不再隐含要求 clone/build Runtime。
- **宿主创建 Kernel**：使用已公开的 `/adapters/dsh` 作为一个具体选择，补齐实际启动入口，复用现有 DSH worker/service；列明需要的文件、Provider 安装和认证、宿主选择的绝对 DSH JavaScript 入口、worker 的编译命令、执行命令与输出。移除本路径对不存在的 `selected-adapter.js` 的依赖。此例不表示 DSH 是所有宿主的默认 Provider。
- 若给出编译步骤，明确源文件和产物路径，并实际验证 Node 能执行编译后的 worker；不能把未编译 `.mts` 直接交给只接受 JavaScript worker 的路径。
- 主包和公开 subpath 足以消费的示例，不导入仓库私有包或未导出的文件，不新增公共 Adapter 导出。源码 submodule 接入继续保留，置于最短 npm 路径之后。
- 例子完整消费事件至真实终态，分别处理执行错误和清理错误。使用现有 signal/取消 API，不把 iterator `break`、client close 或取消 ACK 写成执行已结束。服务拥有者检查 `close().complete`；示例不通过退出宿主掩盖清理失败。
- 新共享示例默认无导入副作用；仅显式运行入口时启动服务或访问外部环境。不得硬编码凭据、擅自修改现有 Runtime Home 或覆盖应用配置。

### R4：Gateway 示例完整但不暴露内部装配

在 `docs/{en,zh-CN}/guides/extras.md` 的生命周期介绍后、详细业务规则前增加最小例子，必要共享代码放在 `docs/examples/`：

- 从 `/host` 导入 `createExtraService`，从 `/extras/channel-gateway` 导入模块及公开依赖类型，使用已有 Kernel endpoint。
- 展示完整 `config: { bots: [...] }` 的必要字段，由示例宿主从运行环境读取实际 API 地址、Bot 身份和凭据；启动前检查缺失值，但不输出凭据，也不提供真实或固定测试凭据值。
- 在同一个装配位置展示同步 `loadContexts` 和返回 Promise 的异步版本，明确选择其中一个。函数返回当前 `ContextItem[]`；函数位于 `dependencies`，不写入 JSON 或跨进程传输。
- 示例包含一种有效的业务 Context payload，不使用渠道保留的 `extra.im` 命名空间；复用现有 Context 合同说明动态整项替换、空数组及失败边界，不新增合并语义。
- 明确仅更新函数读取的数据无需重启 Extra，更换函数引用或配置仍按完整关闭再创建处理。
- 包含 `initialize/status/close` 及清理结果检查。关闭本 Extra 不关闭借用的 Kernel；业务尾流、数据库由实际拥有者收尾，不新增数据库依赖。
- 完成这个例子的必要配置和代码在 `docs/` 内可读；原有根指南链接仅作为高级细节，不成为本例必读步骤。

### R5：分别说明恢复阶段

核对 `packages/octo-runtime-executor-kernel/src/supervisor.ts`、`server.ts`、`client.ts`，只修正双语 CLI、troubleshooting 及其中直接关联的 docs 描述：

| 场景 | 当前实现及文档表述 |
| --- | --- |
| 清理或 manifest 操作失败 | `#retry` 按 1、2、5 秒重试等待，后续保持 5 秒；`exhausted` 表示当前阻塞，不能执行新请求，不能笼统写成永不重试 |
| 替代 worker 启动失败 | 快速恢复等待按 250ms、1s、4s，达到快速预算后进入 15s 慢恢复；不是清理失败的 1/2/5s 策略 |
| 重试时长 | 延迟不含清理、启动和握手耗时，不保证在某个固定墙钟时间内恢复；以 `worker.recovery.stage/code/retry_at` 判断当前进展 |
| 服务与执行状态 | 服务进程 running、IPC 可连与 `execution_ready` 分别说明；旧 Run 不因 worker 恢复而重放 |
| 失败事实 | `WORKER_RESTART_EXHAUSTED` 不能被解释为已执行成功，也不能要求读者立即盲目重启或删除状态；非重试异常仍可能需要人工处理 |

保留最新主线已修正的 `attachKernel({ endpoint })`。无需为本任务调整源代码重试参数或增加手动恢复命令。

### R6：核对首例直接依赖的 Harness 前置条件

`docs/{en,zh-CN}/guides/harnesses.md` 目前将 DSH Provider 写为 `0.2.1-rc.3`，而 Adapter 当前合同区分“固定官方 Client SDK `0.2.1-rc.3`”和“所选 Provider 最低 `0.2.1-rc.4`”。按 `DSH_MIN_VERSION` 及现有 Adapter README 核对这一区别并修正直接相关段落，不重做所有 Provider 调研，不升级依赖。

本地安装、版本探测与真实模型调用属于不同证据；版本满足不保证模型、账号或工具可用。示例不替用户登录，不把 SDK 所带依赖描述为宿主已完成 Provider 安装。

### R7：maintenance 保留历史，明确本次核对范围

现有 `maintenance.md` 的 `d44f5cd... / 2026-10-21` 和 `102fb9... / 2026-10-22` 是当时的验证记录；日期较早本身不构成内容错误。需整改的是开头“整个文档库描述该 revision”的措辞容易让读者将首次验证基线误认为所有后续页面的唯一版本。

- 保留现有章节风格和历史数据，将首次交付基线表述为初始验证记录。既有验证仍绑定其原 SHA、平台、命令及场景，不改写成当前版本通过。
- 增加简短的本次核对说明：所核对的源码 SHA、本次未提交文档/示例变更、涉及页面和执行过的命令、结果、环境及未执行项。dirty 必须说明，不能只写基线 SHA 伪装成全部产物已提交。
- 实现阶段才填写实际通过结果；规格阶段不新增“已验证”的声明。示例 fixture、包外 npm 消费、真实 Provider、IM 和原生 Windows 分别表达，不相互替代。
- 不因这次局部修订声称全库、所有 Provider 或所有平台重新验收完成。不把最新页面数或代码块数作为长期固定验收标准。
- 后续局部修改只有在受影响路径实际验证后才追加对应证据，不要求每次把全库重新绑定到一个 revision，也不建立新的逐页版本登记制度。

## 文件范围

| 文件 | 计划处理 |
| --- | --- |
| `docs/{en,zh-CN}/README.md` | 按任务选择最短入口，保持现有目录导航 |
| `docs/{en,zh-CN}/getting-started/cli.md` | 首次调用提前，必要/可选依赖、预期终态和临时/常驻区别 |
| `docs/{en,zh-CN}/getting-started/sdk.md` | npm attach 路径、完整的自建 Kernel 实例、编译和资源关闭 |
| `docs/{en,zh-CN}/guides/extras.md` | Gateway 最小公开装配、同步/异步 loader |
| `docs/{en,zh-CN}/guides/harnesses.md` | 首例直接依赖的 DSH SDK/Provider 版本区别 |
| `docs/{en,zh-CN}/guides/troubleshooting.md` | 恢复阶段、重试含义和读者动作 |
| `docs/{en,zh-CN}/maintenance.md` | 初始证据与本次复核分开，不覆盖历史结论 |
| `docs/examples/` | 优先复用已有文件；仅补 SDK/Gateway 可运行入口及必要 worker，不建通用示例框架 |

其他 docs 页仅在上述路径发现直接链接或同主题合同矛盾时做必要同步，并在验证记录注明。不得顺便全库润色。`docs/checks/`、现有检查脚本、`package.json`、tsconfig、workflow、运行时源码及导出保持原范围；不新增自动扫描的专项测试。

## 验收

| ID | 场景 | 可观察通过条件 |
| --- | --- | --- |
| A1 | 阅读顺序和风格 | 中英入口均能直接选 CLI/SDK；CLI 最短执行出现在服务运维前，npm SDK 最短路径不依赖 submodule；保留现有有效标题、术语和段落风格，无无关整体改写 |
| A2 | CLI | 文档中的实际请求通过当前 Protocol 校验；显式临时目录内运行构建版 playboard + 受控 fake Provider，得到合法事件及唯一成功终态，退出后无所属活动进程；首例所用 Codex 参数按当前 CLI/Adapter 核对，不把 fake Provider 证据写成真实 Codex 成功 |
| A3 | npm attach | 在仓库之外独立消费目录安装本次构建 tgz，严格编译并执行 docs 的实际示例；用已有 fake worker 启动真实 Kernel，读到 final 和成功终态，关闭 attached client 后 Kernel 仍能被连接；未改造示例以偷偷导入 workspace |
| A4 | 自建 Kernel | 文档给出的 DSH worker、服务和入口能通过主包公开 subpath 严格编译，产物路径及 Node 执行命令成立；已有本地 Kernel fixture 证明初始化/事件/取消/close 路径。实际 DSH Provider 初始化或模型 turn 未执行时分别标记，不将其与 fixture 合并成真实 DSH 通过 |
| A5 | Gateway | 实际共享示例及同步/异步 loader 均严格编译，返回 Context 通过现有校验；显式运行 loader 证明确实返回数组和 Promise、读取当前业务数据；完整装配仅使用公开 API。复用已有 Extra 生命周期 fixture 验证初始化/独立关闭，真实 Bot 联网和消息投递没有执行就不宣称通过 |
| A6 | 恢复与前置条件 | 对照最新 supervisor 源码区分清理/manifest 和启动退避；中英 CLI 与排障没有互斥解释；DSH SDK 固定版本与 Provider 最低版本明确分开；主线已修正签名不回退 |
| A7 | 双语与导航 | 现有 docs:check 通过，配对页互链、代码块、JSON/Context 及现有示例运行检查保持有效；人工复核前置条件、成功含义、取消和清理语义一致。新增片段同样逐条核对，不以代码块一致代替翻译语义检查 |
| A8 | 证据 | maintenance 保留原历史 SHA/日期/结果，新增证据只覆盖本次实际验证；列出 SHA/dirty、环境、命令、结果及未执行项，不能把旧通过升级为当前全库通过 |
| A9 | 变更边界 | 产品 diff 仅在 docs/；流程产物只在本任务目录；没有公开 API、依赖、默认执行行为、测试入口或 GitHub CI 范围变化，既有 Home、身份和配置未被重置 |

本地专项使用临时目录和现有 fixture，以显式终态、退出和清理事实判断；不依赖固定 sleep 推定完成。验证提取或直接运行实际 docs 示例，缺失必需文件、出现类型错误、未得到终态或清理 incomplete 均不得写成通过。临时 harness 不提交到默认测试目录，不修改现有检查器来绕过错误。

## 实现阶段验证顺序

1. 重新 fetch 并核对本规格之后的上游改动；记录实际实现基线。按项目锁定 pnpm 安装依赖，不拷贝其他 worktree 的构建产物作为本版本证据。
2. 增量修改上述 docs 和共享示例，复核参数、导出和实际 CLI JSON 输出。
3. `pnpm build`，随后 `pnpm docs:check`，复用现有示例类型、双语、链接和 fixture 检查，不扩展其 runtime 测试集合。
4. `node scripts/check-developer-docs.mjs --scope current`，对本次页面及其链接目标核对失败；若有未修改历史错误，单独列出，不借机扩大整改。
5. `node scripts/pack-release.mjs`，使用其实际输出的 tgz 执行 `node scripts/verify-release.mjs <tgz路径>`；另在独立消费目录显式执行 A3–A5 的本次示例类型和行为验证，不更改默认打包/CI 检查脚本。
6. 使用现有 fixture 在临时目录显式完成 A2–A5 的定向验证，记录与真实 Provider/IM 的区别。需要真实 Provider/IM 时先核实已有授权、环境和凭据，再独立运行；它们不成为本次文档修订的默认门禁。
7. `git diff --check`，人工复核中英文含义、样式及相对目标分支的变更文件清单。实现阶段按约定进行 code-review，修复问题后只重跑受影响检查。
8. 将实际验证结果写入双语 maintenance 和任务记录。没有完成本项验收的内容明确标注缺口，进入验证审查，不提前宣称原 Issue 全部完成。

## 范围外

- 不修改根 README、CONTRIBUTING、AGENTS、包 README、Octospec 规则/索引或其他仓库治理内容。
- 不翻译历史工程记录，不增加文档网站、全新目录体系或全面风格重写。
- 不新增/调整 Runtime API、Provider 安装逻辑、凭据接口、重连策略、权限、会话和状态持久化。
- 不隐式运行真实模型、访问现有 Bot 或服务管理器，不改变用户 Home、profile、身份及运行实例。
- 不扩大 GitHub CI；本阶段不实施、不提交、不推送、不创建 PR、不发布、不合并。

## 待审查事项与可执行性

本次无阻塞规格编写的待决策点。建议审查以下实施选择：

1. CLI 以现有 playboard 作为第一次执行，常驻服务作为后续用途；不改变 CLI 产品默认值。
2. npm attach 为 SDK 最短入口，复用公开 DSH Adapter 补完整自建服务示例；无需为了示例新增 Codex 等 Adapter 公共导出。
3. 仅以确定性本地验证作为本次门禁；真实 Provider/IM 和原生 Windows 的未执行状态如实保留。若要求本任务完成真实端到端验收，需要单列环境与授权，不能使用历史证据替代。
4. maintenance 保留首次验证历史，只调整歧义措辞并追加实际的局部复核记录。

可执行性自评 **96/100**：目标和修改范围 20/20、接口与责任 20/20、验收 23/25、执行与证据 19/20、风险与授权 14/15。剩余 4 分来自独立消费和新增示例尚待实际编译/执行（2）、当前工作机与其他平台环境差异（1）、实现前需重新核对主线（1）。这是规格准备度，不是测试通过率或实现完成度。

下一阶段为规格审查。用户认可后以“开始实现”进入实现；需要调整本方案时按具体反馈增量修改。
