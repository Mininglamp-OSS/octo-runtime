---
type: Validation
title: Issue 294 原生 Kernel、CLI 与 SDK 文档本地验证
description: 记录原生装配、统一 RPC、CLI 回归、文档检查和未执行的平台及真实 Provider 边界。
tags: [architecture, adapter, ipc, testing, lifecycle, documentation]
---

# 基线与结果

2026-11-02，macOS arm64、Node.js 24.22.2、pnpm 11.19.0；基线 `58332b3bcf5651f58e674fa236184dc6a0d927ca` 加本工作树变更，分支 `codex/294-native-kernel-sdk-spec`。需求见 [#294](https://github.com/Mininglamp-OSS/octo-runtime/issues/294)和[简报](brief.md)。已完成代码与文档实施；用户最新授权提交 GitHub PR，检查通过并满足仓库保护规则后合并 main。

## 已执行检查

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过；没有修改 lockfile |
| `pnpm build`、`pnpm typecheck` | 通过；包括 workspace 和公开导出类型 |
| `pnpm test:suites` | 本地 review 修复后重跑：WebUI 35 项通过；Node 2439 项中 2370 通过、69 跳过、0 失败 |
| `pnpm lint`、`pnpm lint:names` | 通过，无新增命名问题 |
| `pnpm docs:check` | SDK 分章后通过；35 组双语页面、71 Markdown、20 JSON 示例、14 Mermaid、12 类 Context；4 项可运行示例测试通过；高级依赖源码通过类型检查 |
| `node scripts/check-developer-docs.mjs --scope current` | 显式本地检查通过：161 文档、2069 链接、105 锚点，0 错误；新增双语页面另由 docs:check 覆盖 |
| `pnpm native:check` | 3 个生成文件的输入与摘要一致 |
| `pnpm native:test` | Go 43 项、Python 43 项全部通过；真实本地 RPC，隔离 fake Provider |
| `node --test test/host-process-close.test.js` | 4 项通过：正常/失败清理、宿主进程所有权、原生遗留记录确认 |
| `node --test --test-name-pattern='Gateway sdk/normal' test/manual/recovery-teardown.test.mjs` | 显式手动专项 1 项通过：关闭 Gateway 后 Kernel 保持可用，独立调用完成；最终两个宿主进程退出，无执行 worker |
| `node scripts/pack-release.mjs`、`node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | 通过：离线安装、独立工程公开类型和文档示例、原生 Kernel/Extra、CLI 前台服务、卸载保留 Home；本地包未发布 |
| 修改的 JS/MJS/MTS `node --check`、CLI `tsc --noEmit` | 通过 |
| `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` | review 记录加入后通过：610 个 OKF 单元、20 条规则、3886 个本地文件链接 |
| `git diff --check` | 通过 |

Python 首次未安装本工作树 `.venv`，测试报 ENOENT；按现有说明执行 `uv sync --project native/python --frozen --python 3.11` 后，上述 Go/Python 完整重跑通过。迁移期间发现并修正了仍传 manifest 的 fixture、旧 worker 清理断言和本机已安装 octo-cli 导致的缺失命令测试污染；最终通过结果以表中重跑为准。

本地 review 后新增 4 项回归，覆盖实际 probe 生命周期及活 owner 清理失败诊断；[审查记录](review.md)说明复现与修复。首轮全量中 OpenCode 的 4 项检查触发 2 秒版本探测超时；独立重跑该文件 25 项全过，随后保持原命令重跑全量得到上表的 2370 通过/0 失败，没有放宽超时或修改既有用例。构建、lint 与 `tsc -p tsconfig.json --noEmit` 通过。Go/Python、手动 Gateway 和发行包结果属于前一实施阶段，本次 review 后未重复；没有把真实 Provider/Electron 验证列为通过。

SDK 章节按最新指令区分服务接入、高级 dependencies 和可选 AgentRun 使用。CLI 源码确认 executor-kernel run 使用新 createKernelService，channel-gateway run 使用 createExtraService 并由其内部 attachKernel 跨进程连接已有内核；无需再创建内核。

提交准备阶段已按既有格式范围格式化修改文件，重新生成受格式变化影响的 native 摘要；format:check、native:check 通过。最新 typecheck（含构建）及默认全量重跑通过，仍为 WebUI 35、Node 2370 通过/69 跳过/0 失败。对 CI YAML 结构做前后比较，确认触发器、jobs、矩阵、Gate 依赖和步骤数量均未扩展，所有显式测试路径存在。main 当前保护规则要求 CI Gate 及 1 个批准评审，不能绕过，也未更改仓库设置。

## 删除旧架构后的最终验证

按用户“不提供兼容或升级”的最终决定删除 WorkerRpc、心跳、旧资源身份回收及其专属测试。Core/Adapter 适用测试改为真实 Kernel socket RPC；原生资源记录专项 25 通过、4 平台跳过，RPC 迁移定向 56 通过，两套显式手动 fixture 30 通过。

最终 `pnpm typecheck`（含构建）、lint、lint:names、format:check、docs:check、native:check 通过。全量首次发现发行测试仍断言已删除的 worker 身份查询超时配置，删除该旧机制断言后发行文件重验通过；完整 `pnpm test:suites` 重跑为 WebUI 35 通过、Node 2419 项中 2352 通过/67 跳过/0 失败。两阶段数量变化来自删除旧架构专属用例，不通过跳过失败规避回归。

最终重新打包并通过 `verify-release.mjs`：空缓存离线安装、公开 SDK 类型、原生 Kernel、独立 Extra、Gateway 宿主存储、CLI 服务及卸载保留 Home 均通过，未发布包。OKF 仍为 610 单元、20 规则、3886 链接通过；修改的手动 IM 脚本语法通过，未执行线上验证。

CI YAML 再次结构比对通过，新增删除 heartbeat 失效路径后累计移除 5 个旧 worker 测试引用；现有 jobs、矩阵、触发器、Gate 依赖及步骤数量不变，所有显式测试路径存在。PR #295 首个提交的六个平台/Node 组合和 CI Gate 均通过；本轮后续提交结果独立核对，不复用旧 head 的通过状态。仓库要求 1 个批准评审且不启用自动合并，未更改保护设置。

## 撤销逆向 GUI 接入后的验证

按用户追加决定移除整个逆向 GUI Adapter；双语接入页、README、能力矩阵及 Octospec 历史任务/记录中的相关说明、链接和示例也已清理。全仓跟踪文件内容扫描无该 Adapter 名称或包名残留。历史混合验证数量仍对应原始完整范围，不改写为当前支持范围。

- `pnpm typecheck`（含构建）、lint、lint:names、format:check、native:check 通过；lockfile 仅删除对应 workspace 引用，无其他依赖版本变化。
- 全量首次发现扩展清单数量断言仍保留旧值，改为内置数量加一个扩展后重跑通过：WebUI 35；Node 2392 项，2326 通过、66 平台/显式跳过、0 失败。未扩大 skip，数量减少对应已撤销 Provider 的测试。
- `pnpm docs:check`：34 组双语页、69 Markdown、20 JSON 示例、14 Mermaid、12 类 Context；4 项示例测试通过。OKF：610 单元、20 规则、3855 本地链接通过。
- 重新打包并执行离线 `verify-release.mjs` 通过，覆盖公开 SDK 类型、原生 Kernel、独立 Extra、CLI、卸载保留 Home。直接检查 tgz：不含已撤销的包或路径，CLI 仅注册 13 个 Adapter。
- CI 仅删除已移除专属测试的引用；相对 main 的 jobs、矩阵、触发条件、Gate 依赖和步骤数量保持不变。未执行真实 Provider/IM 或 Electron 验收，未修复 Playboard 装配取消问题。

## 合同与证据

| 合同 | 验证与结果 |
| --- | --- |
| 原生对象留在宿主，业务经 RPC | `adapter-composition` 检查原型、this、闭包、可变宿主依赖、同 PID，阻止 spawn；实际 client topology 为 kernel-ipc |
| CLI 独占模块装配 | `adapter-host-manifest`、`native-module-selection`、`module-loading`、`channel-tool-environment` 覆盖 manifest 来源、未选模块不加载、工厂次数、真实 type 与 OpenClaw 准备；常驻和 Playboard 使用相同对象工厂 |
| 接纳、观察与执行分离 | 既有 Kernel invoke/lifecycle/clients、Host SDK、Core 测试迁移后通过；Go/Python 覆盖 ACK 丢失、原身份查询、断线续流、gap/expired、instance 改变、取消/回答 ACK 未知 |
| Provider 子进程仍由 Adapter 管理 | ACP、NDJSON、CodeBuddy、DSH 等 fake Provider 的启动、交互、异常与清理回归通过；未把 Provider 子进程改成 Kernel worker |
| 有界关闭和失败事实 | Core finally 完成后才关闭日志；失败/超时报告 incomplete。原生资源记录保留，活 owner 拒绝人工确认，变更后的记录不能复用旧确认；旧 worker 资源格式明确拒绝且原文件不变，不支持旧架构恢复 |
| Extra 所有权 | Host SDK/Extra 回归与手动 Gateway 专项通过；Extra 关闭不关闭共享 Kernel，独立调用仍完成 |
| 公共文档 | SDK 页仅用途/签名表与实例；源码加载由宿主选择，一句建议 pnpm workspace + Git submodule。CLI、架构、排障、Kernel/Core/DSH README 同步修正 |

删除的 supervisor/worker 心跳、自动替换和执行 worker 强杀专属用例对应已删除的机制；原生装配、取消、绑定、关闭及对象身份用例替代其适用部分。没有将同进程 RPC 写成进程隔离，也没有保留“杀 worker 后原宿主继续服务”的承诺。按用户最终决定，内部 WorkerRpc 类及其专属测试全部删除；仍适用的 Core/Adapter 验收改经真实 Kernel socket RPC，不提供兼容或升级。

## 验证边界

- 真实 Electron 打包运行、实际 Provider 模型调用、线上 IM/MCP：**not run**；Node 风格宿主和 fake Provider 不作为这些场景的证据。
- Windows/Linux 原生运行、Windows 控制台信号与后代进程树：**not run**；本机通过不替代平台验证。地址格式和已有平台模拟回归通过。
- 宿主同步阻塞、OOM 或进程退出共享故障域；同进程超时要求事件循环仍可调度。异常退出后的资源确认是保守恢复流程，不证明自动清理所有后代。
- 无 CI 扩围：提交前发现既有 Windows 步骤仍引用 4 个已删除的 worker 专属测试，已移除这些失效路径并修正步骤说明；没有加入替代专项。默认 test:suites 仍按原模式覆盖当前测试。workflow/job/矩阵/触发器/CI Gate 依赖及步骤数量均保持，实际 CI 列表在提交 PR 后核对。`package.json` 仅将 `host` 从已删除 runner 改为 CLI 宿主入口。

本次知识文件的 type/title/description/tags 已检查。实施总结见[实施记录](../../journal/shared/2026-11-02-294-native-kernel-sdk-implementation.md)。
