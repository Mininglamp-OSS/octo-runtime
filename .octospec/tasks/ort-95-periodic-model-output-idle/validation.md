---
type: Validation
title: ORT-95 周期静默通知本地验证
description: 记录受控专项、真实四分钟 Kernel/client 验证、完整离线检查及渠道验收阻塞。
tags: [validation, runtime, canonical, stream, integration]
---

# 结论

2026-11-14（Asia/Shanghai），Runtime 周期通知已在本工作区实现，本地检查与真实 Kernel/client 专项通过。**完整验收未完成**：A13 真实 Gateway 卡片缺 ORT-93 消费实现；独立子代理现场审查遭遇工具权限错误，只有补丁静态审查与主执行者最终 diff 复核。按 start-implement 失败/缺必要条件分支回到“等待规格审查”，不能将创建本记录或本地通过视为完整交付。

## 代码与环境

- HEAD / 最新 fetch 的 origin/main：`8376be620647f50ef50741a2a6f69c3a1e03a395`，本分支无新增提交。
- 主机：`lvsijiaMacBook-Pro.local`；平台：macOS darwin/arm64；Node `v24.22.2`，pnpm `11.19.0`。
- Worktree：`/Users/lvsijia/codex.mlamp.cn/dmwork/octo-component/octo-runtime-ort-95`；分支：`feat/ort-95-periodic-model-output-idle`。
- Runtime 与 client 均为源码工作区 `0.0.0`，不是已发布版本。client 实际解析到本 worktree 的 `packages/octo-runtime-client/dist/index.js`；未以 npm 旧服务替代本次能力。
- 真实计时集成所用 Runtime 构建元数据：commit 同上述 HEAD，dirty=true，buildTime=`2026-11-13T18:14:43.032Z`。之后 typecheck/test 重建的最终元数据 buildTime=`2026-11-13T18:22:25.753Z`；期间产品源码未改变。
- 核心实现与专项测试的 `git diff origin/main -- packages/octo-runtime-executor-core/src/model-output-silence.ts test/manual/model-output-silence.test.mjs` SHA-256：`e91bf7623dc4031b7a196019ec5bd447cce8b23b5c70f6f033b9ae175ea47d84`。其余差异为规则、双语文档、知识目录与本任务记录。
- 没有提交、推送、创建 PR/MR、合并、发布、安装全局 CLI 或替换运行中服务。原规格文件保留并追加实施授权说明。

## 实现对应

| 验收项 | 实现或证据 | 当前结果 |
| --- | --- | --- |
| A1-A3 周期、迟到、重置 | 独立 interval 的 since/nextMs；周期以原起点定位；60/120/180、65432/190000迟到及新段测试 | 通过 |
| A4-A5 内容与等待边界 | 继续使用 Core 公开新增文本事实；不改 prepareMessage；保留工具/排队/同步交互与 async 边界专项 | 通过 |
| A6 背压恢复 | 同段 pending 冻结、取走跳过历史节点；无 waiter 恢复仅当前一条，下一节点240而非250 | 通过 |
| A7-A8 并发源输出 | pending 持有所属 interval；旧段不推进新段；原 Core 唯一 next/readNext/交付顺序保持；既有双race与deferred测试 | 通过 |
| A9-A10 清理与身份 | interval/listener/timer 三种对象身份；旧回调/同回调旧detach隔离、万次订阅、dispose及源结束/异常专项 | 通过 |
| A11 预算 | 共享受控时钟的 observer+InvocationWatchdog，四种 enforce 截止不被两条周期 notice 延后；产品默认值未改 | 通过 |
| A12 传输、重放、多订阅 | 真 Kernel/socket/client 实际四分钟，原流仍在消费时开启重放订阅，首条帧逐字段相等，Adapter仅调用一次 | 通过（受控 Provider 集成，非真实渠道） |
| A13 Gateway 同卡片 | ORT-93 消费实现尚未进入本地工作树；未向实际渠道发消息、未替换服务 | blocked / not run |
| A14 native/校验 | 原 native 不订阅观察器测试；周期事件经过现有 canonical 校验，Schema/语义负例保留 | 通过 |
| A15 文档/CI | 双语合同与架构同步；文档、元数据、链接检查；workflow/scripts/default test选择无差异 | 通过 |

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，使用现有锁文件；没有更改依赖或锁文件 |
| `pnpm build` | 通过 |
| `node --test test/manual/model-output-silence.test.mjs` | 28 项中27通过、1个真实计时opt-in跳过，0失败；该opt-in随后独立执行通过 |
| `OCTO_SILENCE_LIVE=1 node --test --test-name-pattern='real Kernel/client delivers' test/manual/model-output-silence.test.mjs` | 1通过，0失败/跳过；用例240071.757 ms，总240164.717125 ms |
| `pnpm lint` | 通过 |
| `pnpm lint:names` | 通过，findings为空，保留既有例外 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm typecheck` | 通过，包含重新构建 |
| `pnpm test:suites` | 1464项，1403通过、61既有条件跳过、0失败 |
| `pnpm test` | 构建通过；1464项，1403通过、61跳过、0失败，总测试约12.8秒 |
| `pnpm docs:check` | 修正新增fragment链接后通过，4项文档示例测试通过；未修改检查器或扩大其范围 |
| `python .octospec/scripts/lint.py`（本次临时PyYAML虚拟环境） | 通过；最终单元/链接数随本记录和journal追加，以末次执行输出为准 |
| `git diff --check` | 通过 |

构建、专项与完整命令原始日志保留于本机 `/tmp/ort-95-implement.IeQMR6/`，核心结果已复制到本记录，临时目录不是唯一证据。JSON Schema 的既有 `date-time` format 提示不影响文档检查退出结果。

## 真实计时集成的可证实范围

使用独占 Kernel fixture、真实本地 socket、公开 attachKernel client 与受控 Adapter；没有 mock 通知或缩短产品 60000 ms 阈值。显式设置 first_frame_timeout_ms/model_idle_timeout_ms/run_timeout_ms 为270000，model_idle_policy=enforce，保留有限预算；没有修改产品默认值。

同段三条通知分别落在 `[60000,65000)`、`[120000,125000)`、`[180000,185000)` ms，noticeId 各异，message 与实际整数秒一致。第三条之后受控 Provider 才交出公开文字；新段再经过真实60秒得到第四条，时长位于 `[60000,65000)`。首次 notice 的原 HostFrame 在并发订阅中重放相等，源序号连续，Adapter 调用数一直为1，最后 completed 且 Provider finally 已清理。

该结果证明真实传输路径的周期能力和新段重置，不证明真实 Provider/IM/Gateway 卡片已接入。

## 阻塞与恢复条件

ORT-93 当前 Loop 状态标签为“等待规格审查”并保留“待上游”。对应本地 worktree HEAD=`1b57f2ae18a22c3766b5eaa17c7b539ac2a1cc76`，仅知识目录及规格有改动；`packages/octo-channel-gateway-sdk/src/execution/task.ts` 仍导入并持有 `ImModelWait`，未见生产 `model_output_idle` 消费。因此不能用该树宣称已完成 A13，无须为了本任务擅自修改消费端或发送未经授权的渠道消息。

恢复时保留本 Runtime 工作区。待 ORT-93 消费实现及真实测试渠道可用后，按本 brief 对独占 Runtime/Gateway 进行 A13，记录实际服务构建、client/Gateway版本和同一卡片回读。独立审查工具可用后重跑现场双轴复核；任何代码变更均重新绑定验证版本。完成必要条件后由用户按当前状态发起重试，不能沿用本次受阻状态宣称通过。

## CI 与工作区边界

`git diff origin/main -- .github/workflows package.json pnpm-lock.yaml scripts` 为空。默认 test:suites 仍只选择 `test/*.test.js` 及协议包 `*.test.js`；专项位于 `test/manual`，`OCTO_SILENCE_LIVE` 仅本次显式命令启用。没有新 workflow、job、矩阵、自动触发、必需状态或 Gate 依赖。未创建 PR，未修改远端检查/分支保护；本次实际执行的是上表本地检查，不声称远端 CI 已运行。
