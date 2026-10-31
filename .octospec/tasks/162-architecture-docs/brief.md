---
type: Task
title: Issue 162 当前架构文档与显式链接检查
description: 刷新服务所有权与 Extra 清理说明，为当前文档补齐显式手动锚点检查。
tags: [documentation, architecture, extra, lifecycle, testing]
timestamp: 2026-11-01T00:00:00+08:00
---

# 目标

处理 [Issue #162](https://github.com/Mininglamp-OSS/octo-runtime/issues/162)，让当前开发入口、工作区指南与源码注释准确描述已实现的原生服务合同，并能显式检查当前文档的本地文件和锚点。用户本次要求「按照最新架构刷新，修改相关 scripts check 脚本」。本规格将脚本修改列为实现交付项，当前阶段交付规格供审查。

基线：`origin/main@0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，本次已重新 fetch 并确认 HEAD 与远端一致。分支：`docs/162-architecture-lifecycle`；worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-162`。Loop 任务：`ORT-60`，任务 ID：`ab6eafa0-b232-47a7-9e45-1bc3c5c0744f`。

## 产品意图与决定权

- 业务目标：开发者按现有公开入口集成 Runtime，正确理解服务、进程和清理结果。
- 决定权：Runtime 维护者负责文档与检查工具；HostApp 负责配置来源、安装集合、服务组合、宿主进程及应用数据库。
- 显式输入：当前仓库源码、公开导出、规则、文档链接，以及执行者显式选择的检查模式。
- 合同内动作：修正文档、过期注释和导航，维护检查脚本，记录本地验证证据。
- 越界动作：改变 Runtime 行为、预算或公开 API，恢复 launcher，替宿主决定部署方式，修改 Home/身份/凭据，扩大 GitHub CI。
- 接入影响：SDK 与 CLI 运行行为保持既有合同；新检查能力只供显式运行，不成为默认或必需状态。

## 基线事实

1. Issue 证据锚定旧提交 `8214292132d260c04cf72218580bef741788dd4a`。当前 `DEVELOPMENT.md` 与 `SDK_NATIVE_INTEGRATION_FULL_GUIDE.md` 已删除，入口已迁至 README、CONTRIBUTING、双语 docs 和 Channel Gateway 指南；不得恢复旧入口来满足旧行号。
2. `apps/README.md` 已描述原生服务工厂；`.octospec/guides/workspace.md` 仍包含 owned Kernel/Extra、依赖代理、原生组件启动和 Kernel 依赖具体 Provider 的旧说明。
3. `.octospec/guides/channel-dynamic-contexts.md` 与 `packages/octo-runtime-host-sdk/src/context-loader.ts` 仍写 5 秒清理宽限。实际共享预算由 `packages/octo-runtime-host-sdk/src/shutdown.ts` 的 `shutdownDeadline` 确定，为单调时钟 4000ms 或继承的更早截止。
4. 原三组旧链接在当前根入口、apps、packages、rules/guides 中已未检出，不能宣称当前仍有原来的 21 处缺陷，也不能据此宣称全部现有链接已通过。
5. `scripts/check-developer-docs.mjs` 只扫描 `docs/`，已有 JSON、双语示例、Context 目录和 Mermaid 检查；目前对非空 fragment 直接拒绝。根 `docs:check` 已由现有 CI 调用。`.octospec/scripts/lint.py` 另有本地文件检查，但不验证锚点。

## 关键合同

### 服务、进程与装配

CLI 各组件 run 入口和 SDK 宿主直接调用相同的 `createKernelService` / `createExtraService`。服务在调用进程构造、监听并管理资源；CLI/App 负责宿主进程与系统部署。Kernel 监督内部独立 worker，由 worker 使用唯一 `AgentExecutor` 执行；Extra 只连接指定 Kernel，不启动或停止 Kernel。普通执行复用 `KernelClient.invoke`。

Host SDK 不提供另起顶层 Kernel/Extra 的 owned launcher、外部组件启动器或依赖代理。宿主显式选择 Adapter、Extra 和 worker 入口；Core、Kernel、Host SDK 不依赖具体 Provider/业务 Extra。CLI 的 manifest、系统服务和全量发行集合不成为 SDK 宿主的通用要求。SDK 不接管应用数据库。

本次只迁移说明和链接：旧 daemon 命令及部署脚本指向当前 CLI、SDK、部署文档中的真实入口；旧 SDK 大指南指向当前分场景文档；不新增兼容执行路径。历史 journal/tasks 中的已版本化证据不参与改写。

### 清理预算

Extra 的插件取消、调用排空、dispose、依赖收尾共用最多 4000ms 的单调预算；继承更早截止时使用更早截止，各阶段不得重置。超时只结束等待，实际 Promise 未结束仍占容量；清理不完整保留 incomplete 和冲突所有权，迟到完成不将已返回失败改写成成功。同步阻塞无法靠 Promise timer 强停。

Kernel 关闭的 5 秒预算与动态 Context load 默认 5000ms 分别保留。不得按数字全局替换，不将预算描述成跨机器严格耗时保证。`extra-service.ts` 的独立计时或备用值须结合真实调用顺序判断，本次不修改运行时逻辑。

### 检查脚本接口与 CI 边界

维护 `scripts/check-developer-docs.mjs`，增加显式模式 `--scope current`。无参数运行保留原有 `docs/` 文件集合、现有检查、fragment 策略与退出行为；根 `docs:check`、默认测试、发行脚本和 workflow 不接入新模式。

`--scope current` 只检查当前文档的本地链接与锚点。该分支必须在加载运行时产物和协议校验器之前分流：安装仓库已有开发依赖后即可运行，无需先构建 Runtime；不加载真实 Provider、不联网检查站点。复用已有 Prettier Markdown AST；复杂链接不得用全文正则提取替代 AST。确有复用需要时将链接逻辑抽到 `scripts/lib/`。

当前文档源集合为 Git 跟踪的根目录 `*.md`、`apps/**/*.md`、`packages/**/*.md`、`docs/**/*.md`、`.octospec/rules/**/*.md`、`.octospec/guides/**/*.md` 和 `.octospec/index.md`。读取这些文件的工作区最新内容。生成目录、依赖目录、第三方 vendored 内容不作为文档源；通过检查工具显式记录确需排除的具体路径和理由，不采用包级宽泛豁免。`.octospec/tasks`、`journal`、`learnings` 和 `_global` 不作为源集合；当前文档链接到其中实际文件时仍验证该目的地及锚点。

本地链接语义：

- 处理内联链接、图片、引用式链接及对应定义；忽略代码块内的示例链接，不将裸代码中的旧标识当导航。
- 相对文件路径以源文件目录解析；`#fragment` 以源 Markdown 自身为目标。路径和 fragment 各自 URL 解码，非法编码报告错误。限制解析后文件在仓库边界内，避免把同前缀的相邻目录误判为仓库内部。
- Markdown 目标支持 ATX/Setext 标题、标题内代码/强调/链接文本、中文和其他 Unicode、标点及同页重复标题的 GitHub 后缀规则，也接受显式 HTML `id` / `<a name>`。不能用整个文件包含目标字符串代替锚点存在性。
- 存在的非 Markdown 文件只验证路径；本工具不验证其行号或自定义 fragment。目录链接只验证目录存在，不假定其有 Markdown 标题。
- 外部 URL（含固定 commit 证据）、`mailto:` 和协议相对链接计数并跳过，不发 HTTP。仓库外本地路径、无法读取的目标、未知 Markdown fragment 和未解析引用均报告失败。
- 一次收集全部错误，按源文件、行号、原始 URL、原因输出，并汇总源文档数、链接数、fragment 数和跳过数。通过退出 0，检查失败退出 1，未知/缺失参数退出 2；零文件不得伪装成功。

新增脚本回归位于 `scripts/checks/developer-doc-links.test.mjs`，用显式 `node --test` 执行；不得放入 `test/*.test.js` 或 `docs/checks/*.test.mjs`，也不得被默认脚本间接加载。用独占临时目录覆盖成功与失败路径，不能改动待验收源文件或请求远端服务。

## 实现范围

| 位置 | 交付要求 |
| --- | --- |
| `.octospec/guides/workspace.md` | 按当前 package.json 和工厂调用链修正目录职责、依赖方向、进程所有权与开发命令 |
| `.octospec/guides/channel-dynamic-contexts.md` | 更正 Extra 共享清理期限，区分 Context 加载超时 |
| `packages/octo-runtime-host-sdk/src/context-loader.ts` | 仅修正过期清理注释 |
| 当前根入口、apps/packages README、双语 docs、rules/guides | 核验导航和服务边界；只修改与本 Issue 同主题的失效链接或说明，保持双语示例一致 |
| `scripts/check-developer-docs.mjs` 及必要的 `scripts/lib/` | 提供显式当前文档链接检查，保留默认 CI 行为 |
| `scripts/checks/developer-doc-links.test.mjs` | 手动回归锚点解析、范围选择、错误报告和退出码 |
| `CONTRIBUTING.md` 或工作区指南 | 写明新模式与回归的手动命令、默认范围和能力限制 |
| 本任务记录 | 保存原三组链接迁移核对、当前错误清单、验收结果及实际版本 |

原清单按三组保留追踪：README 旧执行结构 15 处、Extra JSON Schema 旧标题 3 处、旧 SDK 指南 3 个改名标题各 1 处。实现阶段从原提交提取来源及原始 URL，逐项记录当前来源是否仍存在、链接替换/删除情况与新目标检查结果；不凭检索不到旧字符串推断 21 项全部修复。无需为了凑数量新增兼容锚点。

## 范围外

不改变 SDK、CLI、Kernel、Extra 的运行行为、公开导出、默认值或依赖装配；不恢复已删除文档或 launcher。历史方案不批量重写。除必要的检查工具依赖外不调整依赖，不升级框架。不安装/启停真实服务，不调用模型，不操作真实数据库，不提交或推送代码，不创建 PR，不扩大 GitHub CI。

## 验收

| 编号 | 可观察通过条件 | 验证依据 |
| --- | --- | --- |
| A1 | 当前开发入口引用的命令、文件和公开工厂存在；工作区职责与当前依赖图及原生构造一致 | 源码和 package.json 对照，当前文档检索；静态核对不写成真实平台运行通过 |
| A2 | 两处过期 5 秒清理文案均改为共享 4 秒或更早截止；Kernel 和 Context load 各自 5 秒不被误改 | 文档/注释 diff 与 `shutdown.ts` 对照 |
| A3 | 原 21 项有逐项迁移记录，现有同主题导航指向存在的文件和标题/显式 ID | 原提交清单、迁移表、当前检查输出 |
| A4 | 新模式覆盖规定的根/包/指南文档源及目的地，独立于 Runtime 构建，全部同主题链接错误已修复 | `node scripts/check-developer-docs.mjs --scope current`；其他主题遗留问题逐项记录，不静默排除或宣称全量通过 |
| A5 | 回归涵盖引用式链接、编码中文与空格、同页标题、重复/格式化/Setext 标题、显式 ID、失效目标/锚点、边界逃逸、代码块与外部 URL 跳过、默认/显式范围及无效参数退出码 | `node --test scripts/checks/developer-doc-links.test.mjs` |
| A6 | 原有 docs 检查及双语示例仍通过；默认扫描集合与原来一致，扩展模式不进入 CI | 构建就绪后运行 `pnpm docs:check`，对照默认源文件清单及脚本调用图 |
| A7 | workflow、根默认脚本和默认测试入口相对基线无扩展 | `git diff origin/main -- .github/workflows package.json`，检查新增测试路径没有被既有入口自动匹配 |
| A8 | 规格与记录符合 OKF，diff 无空白错误；实现按标准与规格双轴审查并修复有效问题 | `git diff --check`；OKF frontmatter/链接核对；实现阶段应用 code-review |

若脚本发现其他主题的遗留错误，记录源码版本、失败命令、具体文件及原因；保留非零结果。不能将部分修复写成全库链接通过，也不能为通过本任务批量排除规则目录。只有全部必需结果可核实后，才提交验证审查。

## 执行顺序与审查事项

1. 规格审查通过后，在原 worktree 实现手动检查模式和手动回归，先确定当前文档链接基线。
2. 按源码刷新拓扑、命令、预算说明及同主题导航，记录原 21 项迁移状态。
3. 执行手动专项、既有文档检查和 diff 检查，记录通过、失败和未执行项；使用 code-review 复核并修复。
4. 将当前代码版本、工作区状态和验证结果回写 Loop，进入验证审查。提交、推送和 PR 另按用户明确授权执行。

已确定：以当前架构和源码为准；维护已有脚本但扩展检查仅显式启用；保留默认 CI 范围；保留历史语境；检查只证明文档一致性，不证明真实平台执行。

待决策项：无阻塞产品或接口决策。审查重点为显式模式 `--scope current`、上述源集合和原 21 项逐项迁移口径。具体 parser 实现和临时夹具组织属于实现阶段工程选择。

可执行性自评 **97/100**：目标及责任 20/20、范围及兼容 20/20、脚本合同 24/25、验收 24/25、风险及恢复 9/10。差额 3 分分别来自 GitHub 标题边界需夹具验证、原 21 项需逐项提取、当前全量错误清单尚待新模式执行；这些是明确的实施验证工作，不是已通过结论。
