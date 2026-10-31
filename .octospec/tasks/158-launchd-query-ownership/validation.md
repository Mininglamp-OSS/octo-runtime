---
type: Journal
title: Issue 158 实现与本地验收
description: launchd 查询失败保留定义的实现、双轴审查及 macOS 原生验收事实。
tags: [runtime, lifecycle, testing]
---

# 结论

按 [brief](brief.md) 实现：查询失败抛结构化错误，只有确认目标服务缺失才按幂等停止/卸载处理；CLI 对错误快照显示自启 unknown。相关回归、手动专项、原生 macOS 专项及构建/类型/静态检查通过。未提交、推送、创建 PR、合并或部署。

## 代码版本与环境

- 基线及当前 HEAD：`a5a32835882deab5e2364b559dd06bf1675c1335`，分支 `fix/158-launchd-query-ownership`，存在本任务未提交改动（dirty）。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-158`。
- macOS `26.6.2`，build `25G83`；Node `v24.22.2`；pnpm `11.19.0`；原生 `/bin/launchctl`，GUI 域 `gui/502`。
- 依赖使用 `pnpm install --frozen-lockfile --ignore-scripts` 安装，未修改 lockfile。
- 最终源文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| packages/octo-runtime-cross-service/src/launchd.ts | a90039604b2cc9671b7a48b01fcc269326e31669bc0a5befa5123d53c1dfc6aa |
| apps/cli/src/output.ts | 781809425f691e4380377dfb1696a3460539777619a66c8a98858bbc368682d1 |
| test/manual/launchd-query-ownership.mjs | 2229947af5bf11ccf8fa89272456737bff96c83c78cd7d5155f04d8430c9784b |
| test/manual/launchd-query-ownership-native.mjs | 1bc2648bb418da343a2ef7d4afdc5b5447dffa67696531e73fa32f70e8df181b |

## 验收映射

- A1/A10：明确缺失时 stop 保留 plist、重复 uninstall 成功；查询故障恢复后可重试完成卸载。
- A2/A3/A8：权限、超时、域不可用、裸 113、错误 label、错误 uid、错误退出码和未知诊断均拒绝；inspect/stop/uninstall/install/start/restart 不继续修改服务，保留定义原字节。首次 install 故障不会创建 plist。
- A4：print-disabled 失败让 inspect/start/restart 失败；实际 CLI 调用真实后端的查询失败时返回 unknown/COMMAND_FAILED，文本自启 unknown，不泄露注入诊断正文。JSON enabled=false 仍为既有兼容占位值。
- A5/A6/A9：bootout 失败、停止后查询失败均保留定义且不 bootstrap；已写入替换参数时保留当时的定义，不伪称回滚。
- A7：异步停止等到明确缺失；持续已加载通过加速测试时钟验证有界失败，保留定义。未改变生产超时预算。
- A11：现有四种 override 格式、正常 start/stop 和 formatter 的已知 on/off 回归通过。
- A12：删除文件 IO 失败和 runner 异常传播，原始 cause 可保留，不假报成功。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | 通过；WebUI 有 module directive 与 chunk size 构建警告，构建退出 0 |
| `pnpm typecheck` | 通过，包含重新构建及根 TypeScript 检查 |
| `pnpm lint` | 通过 |
| `pnpm lint:names` | 通过，无新 findings |
| `node --test test/cross-service.test.js test/cross-service-failures.test.js test/cross-service-runner.test.js test/cli-lifecycle.test.js` | 84 通过，13 个 Windows 专项在 macOS 跳过，0 失败 |
| `node --test test/manual/launchd-query-ownership.mjs test/manual/launchd-query-ownership-native.mjs` | 22 通过，原生项未设置显式开关而跳过，0 失败 |
| `OCTO_LAUNCHD_OWNERSHIP_NATIVE=1 node --test test/manual/launchd-query-ownership-native.mjs` | 最终修正后 1 通过，0 失败，0 跳过 |
| 变更文件 `prettier --write` / `git diff --check` | 已格式化，diff 空白检查通过 |

首轮手动专项有 1 条夹具失败：仅修改 description 不改变 launchd plist，因此未进入替换分支。改为修改启动参数后该用例与全部 22 项通过；产品实现未因该夹具问题放宽分类。

## 原生证据与清理

最终运行 label：`com.octo.ownership-90b82f79-b7db-45e1-b05f-15296411de66`，运行 PID 为 `30128`、再次启动为 `30150`。真实 `/bin/sleep 300` 由 launchd 管理，无 Provider、业务 Home 或现有 Runtime 服务参与。

- 注入 print/print-disabled exit 5 后，失败结果保留 plist，独立真实控制后端确认 job 仍在运行。
- 恢复查询后，stop 确认 job 缺失且 plist 保留；uninstall 与重复 uninstall 成功。
- 再次真实启动，bootout 已成功后注入查询故障，uninstall 返回失败且定义保留；恢复查询后重试完成删除。
- finally 独立控制后端确认 job 不存在、两个 PID 均已退出，然后删除临时目录；清理失败不能通过。主体和清理同时失败时用 AggregateError 保留两种错误。
- 首轮原生运行也通过并确认 job、PID、目录清理。原生 install 的 enable 操作会留下 launchd 的 label 级 enabled override 历史记录；两次独占 label 的记录仍可见，既有 uninstall 不移除该覆盖项。没有残留 job、plist 或进程；未通过 reset-disabled 清理整个用户域，以免影响其他服务。

这里是真实 job + 注入查询故障，未复现原生权限拒绝。未知 macOS 版本/本地化诊断仍保守报错，不保证所有版本输出均可识别。

## 审查、CI 与交付

[双轴审查记录](review.md)：Standards 首轮 1 项低严重度问题，已修复并复核；Spec 0 项问题。最终两轴均无未解决问题。

相对固定基线的 `.github/workflows`、`package.json` 和 `scripts` diff 为空；现有顶层测试仅修正原有 launchd fixture 响应，不增加测试条目；新增两份 `.mjs` 专项位于 `test/manual/`，不匹配默认 `test/*.test.js` 或现有默认入口。未增 workflow/job/矩阵/触发/必需检查或测试开关。

全仓全量 `pnpm test`、Windows/Linux 原生专项、真实权限拒绝、跨 macOS 版本矩阵均未执行；本轮验证范围为 brief 中的本地检查与相关回归。没有远端 CI 运行或通过结论。

下一步等待用户审查验证结果。未获提交/推送授权，本地改动保留，不创建 PR。

## 更新主线与 PR 交付复验

用户随后明确要求“更新最新代码，提交 PR”，已认可前述验证并授权提交、推送和创建 PR，不授权合并。

- 本轮 fetch 的最新目标：`origin/main@c35b261b31573bc2f08a16eeced12f18705b2560`，包含原基线后的 4 条渠道、打包和文档提交。
- 本任务实现提交已 rebase 至该目标，复验版本 `78a627770bf589091b9d2971cd8730ca22063c77`，复验时工作区干净。只有 `.octospec/log.md` 内容冲突，已保留主线及本任务全部记录。实现和测试文件相对同步前逐字节无变化。
- `pnpm typecheck`（包含完整 build）、`pnpm lint`、`pnpm lint:names` 通过。首次 lint 与清理重建并行时出现产物缺失导致的类型解析错误，构建结束后单独重跑退出 0；该失败没有通过修改规则或关闭检查规避。
- 同一相关回归命令重新运行：84 通过、13 Windows 平台跳过、0 失败。
- `node --test test/manual/launchd-query-ownership.mjs` 重新运行：22 通过、0 失败。
- 显式原生命令重新运行：1 通过；label `com.octo.ownership-9492f0a0-dd42-4ec5-83ae-19674c8e7163`，PID `33783`、`33803` 均退出，job/plist/目录清理确认。该 label 同样保留既有 enabled override 历史项，未修改其他服务。
- `git diff --check origin/main...HEAD` 通过；相对新目标 workflows/package.json/scripts diff 为空，默认测试条目未增加。
- 上述源文件 SHA-256 保持，后续仅更新本节等交付文档。最终提交及 PR 地址以 Loop 结果评论和远端 PR 为准。

本次未重跑全量 pnpm test、真实权限拒绝或跨平台原生矩阵；原有未验边界继续适用。既有代码审查仍适用于未变化的实现，冲突仅为日志合并。
