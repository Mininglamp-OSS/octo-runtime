---
type: Journal
title: "Issue 263 实现与本地验证"
description: "默认 24 小时、七天上限、长时监督及 frontmatter 修复的证据与限制。"
tags: [invoke, protocol, testing]
timestamp: 2026-11-01T00:00:00Z
---

# 结论与版本

已实现[brief](brief.md)中的公共长时预算合同，完成本地验证及[双轴审查](review.md)。等待用户审查验证结果，未提交、推送、发布或创建 PR。

验证对象：`fix/263-long-running-invocations`，HEAD/基线 `0bcd89c528018ffd508ca8099c8ac9c6b88de35d` 加本次未提交变更。worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-263`；主机 `lvsijiaMacBook-Pro.local`。macOS arm64，Node `v24.22.2`、项目 pnpm `11.19.0`、Go `1.26.1`、Python `3.12.14`，DSH CLI/SDK `0.2.1-rc.4`。

## 实现对应

- A1/A2：Schema、Context 与 RuntimeLimits 校验的整轮范围为 `100..604800000`；入口、watchdog、DSH 共用 24 小时默认值。顶层对象整体优先，其他检测上限与合并语义不变。
- A3：真实公共 Kernel IPC 传递顶层及 Context 的 72 小时/七天预算。两种越界请求均拒绝，fake Provider 启动文件不增加。
- A4/A5/A6：fake clock 按序推进 timer，以真实模型/工具进度保持健康，覆盖 24 小时、72 小时、七天前 1ms 与恰到期限；独立首帧/模型空闲/工具空闲、短期限、observe、审批和总期限优先级有效。
- A7：长时状态显式取消释放 watchdog timer，真实 Core shutdown 与 Kernel close 清理活动七天预算调用；真实 DSH 取消不影响独立 sibling。
- A8：未修改的官方 SDK `request` 使用传入毫秒直接安排 Node timer。手动专项截获真实 timer 的 requested/scheduled 值，证明 24 小时、72 小时、七天均未缩短，并在正常终态后清除 timer；Adapter 原调用及 fixture 终态全部完成。
- A9：长时 timeoutMs 与安全整数时间证据不再因超过 24 小时被过滤，超期回调延迟仍保留 elapsedMs；计数上限、诊断白名单与公开错误码不变。
- A10：重新生成 native Go/Python 校验规则及输入 hash；共享 `limits-boundaries` 样例替换为七天上界并更新 canonical/hash，没有增加自动执行样例数量。Go 中随规则编号顺延的 diff 是生成结果，不是手工重排。
- 按用户补充授权，为 Issue 137 brief/review、Issue 246 validation、2026-10-29 的 137 journal 补齐 frontmatter，仅增加元数据，保留历史正文。

## 最终检查结果

| 命令或场景 | 结果 |
| --- | --- |
| `pnpm build` | 通过 |
| `pnpm typecheck` | 通过，含重新构建及根类型检查 |
| `pnpm lint` | 独立运行通过 |
| `pnpm lint:names` | 通过，0 findings |
| `PATH=<隔离的同版本 Node 目录>:$PATH pnpm test` | 通过；既有 Node 测试 2389 通过、91 条件跳过、0 失败；WebUI 既有测试也通过 |
| `PYTHONPATH=native/python/src OCTO_NATIVE_PYTHON=<Python 3.12> node --test test/manual/263-long-running-invocations.mjs` | 13/13 通过，含 Go/Python 公共预算编解码及真实本地 IPC |
| `PYTHONPATH=native/python/src OCTO_NATIVE_PYTHON=<Python 3.12> node native/tests/run.mjs --suite protocol --evidence .tmp/263-native-protocol.json` | Go、Python 分别通过原有 434 个共享协议样例 |
| `node native/codegen/generate.mjs --check` | 通过，3 份生成文件的输入与文件 hash 匹配 |
| `pnpm docs:check` | 通过，4 个文档测试通过 |
| 修改过的 TS/JS/JSON 文件显式 `pnpm exec prettier --check ...` | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过，包含补齐的 4 份 frontmatter |
| `git diff --check` | 通过 |
| `git diff HEAD -- .github package.json pnpm-workspace.yaml` | 空；未改 workflow、默认脚本、glob、开关、依赖锁文件或必需状态 |

新增手动专项与 Adapter/manifest 仅位于 `test/manual/263-*`，未进入默认测试入口。唯一既有 watchdog 测试修改是将原“3 小时默认值”断言替换为 24 小时，没有新增默认执行的测试。未创建 PR，所以没有新增托管检查列表；CI 执行入口相对基线保持原样。

## 初次失败与恢复

- 系统 `/usr/bin/python3` 为 3.9，无法导入 `typing.NotRequired`；改用本机既有 Python 3.12，未改产品或依赖合同。
- 手动 fixture 最初省略审批模式，按既有合同被拒绝；已在测试显式选择 `full_access`。产品默认审批策略不变。
- 首轮 lint 与后续构建清理 dist 重叠，出现类型不可解析；构建完成后独立执行 lint 通过。一次手动 Kernel 测试也与全量重建 dist 重叠，失败后在构建完成的同一源码上单独重跑，13 项通过。
- 原环境的 `pnpm test` 有 1 项失败：`test/verification-command.test.js:162` 预期不存在 `octo-cli`，但 fixture PATH 包含 Node 所在目录，该目录实际安装了 `octo-cli`。同 SHA 的干净 worktree `/private/tmp/ort82-baseline-20261101` 上独立运行同文件，得到同样 ENOENT 预期失败（7 通过、1 失败、10 跳过），确认与本次改动无关。
- 未修改这项无关测试；将同一个 Node 二进制复制到独占临时目录 `/private/tmp/ort82-node-gj2Akg` 并置于 PATH 首位，隔离全局安装后重新完整执行 `pnpm test`。结果 2389 通过、91 跳过、0 失败，未跳过或筛除失败测试，也未改变测试数量。
- Spec 初审的一项 P2 测试证据缺口已补齐，审查者只读复核确认闭环；最终专项随后通过。Standards 0 项、Spec 剩余 0 项。

## 独立真实 DSH 验收

显式执行既有脚本（non-gating）：

```bash
OCTO_DSH_NATIVE_BIN=<宿主已安装 DSH 的绝对 JS 入口> node scripts/verify-dsh-live.mjs
```

本机 DSH `0.2.1-rc.4`，结果：首轮 completed；同一原生会话恢复并读回 marker；工具事件及文件副作用一致；不存在的恢复会话明确失败且不补建；Provider 失败保持失败；取消达到 cancelled，独立 sibling completed；随后新调用 completed；最终 `cleanup.complete: true`，errors/pendingResources 均为空。只记录安全结果，不保存认证或完整模型轨迹。

## 验证边界

- 没有真实等待 72 小时或七天；长时进度和精确期限由可控时钟证明，公开 IPC/清理由真实本地服务与 fake Provider 证明，DSH 真实验证只覆盖短调用及生命周期。
- 本轮未修改或重启外部桌面宿主、Worker 项目，也未执行 im-test 注册和端到端同步任务。仓库内真实 Kernel/DSH 已验，不能据此宣称外部宿主已升级或同步任务已实跑 72 小时。
- 未实测 Windows；沿用既有平台与进程树回收保证，不将 macOS 结果推导为全平台保证。
- 任务本地验收不代表云端、桌面产品发布或线上业务验收。首次采用新版 Runtime 的宿主仍需显式配置 72 小时并完成自身接入验证。
