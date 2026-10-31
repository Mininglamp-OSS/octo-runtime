---
type: Task
title: 待握手容量回归必须验证成功完成
description: 修正容量夹具的非法控制状态，确保成功终态、输出保留、TTL 释放和后续调用受到真实断言保护。
tags: [testing, stream, protocol]
---

# Issue 144：待握手容量回归的成功路径

## 状态与依据

- 状态：用户已认可规格并授权实现、提交推送及创建 PR；实现与本地验证完成，准备代码审查。
- 来源：[GitHub #144](https://github.com/Mininglamp-OSS/octo-runtime/issues/144)、Loop ORT-46、分诊评论 `f9ccf515-3d2c-42b3-b35e-441e2ccb85dc` 及用户“开始写spec”。
- 规格基线：`db427e85dbaf1c19e79452ed4a45f6080c440a0f`；实施前已 fetch 并快进至 `origin/main@c35b261b31573bc2f08a16eeced12f18705b2560`。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-144`；分支：`fix/144-handshake-capacity`。
- 相比分诊基线，后续主线提交未改变本问题的测试、HostRunService 和协议校验文件。

## 目标与责任边界

让现有容量回归真实覆盖健康执行路径，避免全部调用失败仍通过。容量准入、源帧窗口和终态 TTL 属于 Executor Kernel；测试负责提供合法源帧，并验证接纳、执行结果和资源释放分别成立。维护者决定测试标准，调用方仍决定业务内容和持久化策略。

显式输入是本地测试构造的 128 个唯一请求及受控源帧。合同内动作仅为修改测试夹具、读取 Host 公开状态与回放、控制测试时钟及关闭测试资源。不得通过放宽协议、改变生产容量或 TTL 来让测试通过。其他 SDK、CLI、Extra 和 Provider 的运行行为不受影响；不涉及服务拓扑、公共 API 或资源所有权变更。

## 已知缺口与关键合同

`test/host-run-service.test.js` 的目标用例首帧发送非法 `accepted`，而 Host 控制状态只允许 `running/completed/failed/cancelled/lost`。首帧校验失败后，Host 写入错误和 lost；后台 submit 已返回接纳回执，其后台异常不直接使调用者 await 失败。lost 同样不计入 activeRuns，因此仅等待活动数归零无法证明成功。

现有 128 Run 上限同时包含待接纳调用和保留的终态记录。帧及终态记录 TTL 为 120 秒，按帧写入时间及最近更新时间计算，在读取或接纳等操作中惰性清理。submit 回执不是执行终态；TTL 前必须实际读取输出，TTL 后必须确认旧记录与回放不可用。

## 实现范围与方案

仅修改现有 `Host counts pending handshakes toward capacity and releases expired terminal runs` 用例及本任务知识文件。保留原测试入口、128 请求 gate 和超额拒绝逻辑，复用 preparedSubmit、Host get/read 与 Node 测试 mock，不新增通用抽象或依赖。

1. 在创建 Host 和提交请求前，以 `t.mock.method(Date, "now", ...)` 安装测试私有的可推进时钟，初始为固定有效毫秒时间 T0。真实异步调度和计时器继续工作，不等待实际 120 秒。
2. gate 关闭时源不输出首帧，确保全部 128 个调用仍处于待握手阶段，检查 admittingRuns 和超额拒绝。
3. gate 放行后，每条源流按序输出三帧：seq 1 的 running 控制帧；seq 2 的合法 canonical `message.delta`（protocolVersion 2、channel final、含对应 runId 的确定文本）；seq 3 的 completed 控制帧。所有帧继承对应请求身份，protocol_mode 为 canonical，preparedSubmit 显式选择 canonical。
4. 保存每个请求及接纳回执；用有界等待确认所有运行出现终态，再逐个断言 completed 和完整回放，而不是只等待 activeRuns 为零。检查完整三帧序列、预期文本和身份，同时排除任何 error 控制帧及非成功终态。等待使用测试内局部轮询，以真实单调时钟 `performance.now()` 限定 2000 毫秒、每 10 毫秒检查一次；旧调用作为一组共用期限，fresh 使用独立期限。不能使用以 Date.now 计时的现有 waitFor，否则固定时钟会令失败场景无限等待；不修改共享 waitFor。
5. 时钟保持 T0 直至全部旧调用成功。推进到 T0 + 119999，验证全部旧记录和输出仍可读，且新身份请求仍因终态记录占满窗口而被拒绝。读取不得延长保留期。
6. 推进到 T0 + 120000，逐个验证旧 get/read 报 RUN_NOT_AVAILABLE；随后提交 fresh，等待并验证与旧调用相同的成功终态和确定输出。检查 activeRuns、admittingRuns 最终均为零。
7. 清理 hook 必须在可能失败的断言前注册；保证 gate 在失败路径也释放，然后 await host.close()，时钟由测试 mock 生命周期恢复，避免挂起源流或污染其他测试。

## 验收标准

| ID | 场景 | 可观察的通过条件 |
| --- | --- | --- |
| AC1 | 待握手容量 | gate 关闭时 admittingRuns 为 128，第 129 个唯一请求以 RUN_CAPACITY_EXHAUSTED 拒绝。 |
| AC2 | 全部调用成功 | 放行后全部 128 个请求有匹配回执，公开查询终态均为 completed；每条回放均为 running、预期 final 文本、completed，seq 连续为 1/2/3，身份匹配；没有 error/lost/failed/cancelled。 |
| AC3 | TTL 前保留 | T0 + 119999 时全部旧记录及完整输出仍可读取；新的唯一请求仍被容量拒绝。 |
| AC4 | TTL 释放 | T0 + 120000 时全部旧 get/read 均以 RUN_NOT_AVAILABLE 失败；旧输出不再可回放，新请求可接纳。 |
| AC5 | 新调用完成 | fresh 必须在有界等待内达到 completed，并具有正确身份、连续三帧及预期 final 文本；最终 activeRuns/admittingRuns 为零。 |
| AC6 | 能捕获原缺陷 | 单独将 running 恢复为 accepted，目标测试非零退出；单独删除 completed 帧，目标测试非零退出。每次负向实验后恢复正确夹具，最终正确版本通过。 |
| AC7 | 清理与范围 | 正确版本目标用例及整份文件通过，无挂起；业务实现、协议、依赖、测试脚本及 CI 范围均无变化。 |

## 本地验证计划

以下均为实施阶段待执行，不代表本轮测试结果。

1. 必要时 `pnpm install --frozen-lockfile`，依赖与锁文件保持不变。运行 `pnpm typecheck`（包含构建）、`pnpm lint`。
2. 运行 `node --test --test-name-pattern="Host counts pending handshakes" test/host-run-service.test.js`，再运行 `node --test test/host-run-service.test.js`，分别记录结果。
3. 在测试文件中逐项临时注入 AC6 的两种缺陷，每次只改变一个条件，显式运行目标命令并记录非零退出及触发的失败断言；不得只把环境/导入失败视为成功杀死变异。还原后重跑目标测试，确认最终 diff 不保留负向变异。不新增专项脚本、默认测试开关或 CI 步骤。
4. 运行 `python3 .octospec/scripts/lint.py` 和 `git diff --check`；核对相对基线的 workflow diff、package scripts 及实际检查列表，确保 CI 范围没有直接或间接变化。
5. 按 code-review 技能执行实现后的规格与仓库标准审查，修复有效问题。证据记录 SHA/dirty、平台、命令、逐项通过/失败/未执行和原因；自动化结果与真实环境结果分别说明。

本任务仅验证确定性本地 transport fixture。不要求真实 Provider、模型、网络、IM 或 Windows 原生专项，也不以本地通过推断这些场景可用。无需因测试修改扩大到全量跨包合同验证；若发现生产缺陷，记录后重新明确范围。

## 决策与审查事项

已由需求和分诊确定：保留待握手容量覆盖；必须证明全部调用成功、TTL 内输出存在、TTL 后释放和 fresh 实际完成；保持现有生产协议及 CI 范围。

本规格给出的具体选择供本次审查：三帧合法 canonical 夹具、逐个检查全部 128 次、119999/120000 毫秒边界、终态保留期满载拒绝、两次临时负向实验。无阻塞技术待决项；若用户调整这些选择，增量更新本文件。

可执行性自评：97/100。文件范围、时钟、帧结构、等待与清理顺序、逐项断言和验证命令均明确；剩余为实现时需实测 mock 生命周期和异步收尾，不代表已验证通过。评分为规格自评，不是独立质量认证。

## 授权与后续

用户已通过“更新最新代码 开始实现->更新代码->提交PR”认可规格，并授权实现、提交、推送及创建 PR；检查通过后依序交付，不自动合并。GitHub issue/PR 和 commit 使用英文，保留 Git 作者配置及规定的 Codex trailer。
