---
type: Implementation
title: Executor Kernel 与 Host 生命周期实施记录
description: 独立组件实现、本地自动化证据、旧测试替换与待验项。
tags: [implementation, lifecycle, ipc, testing]
timestamp: 2026-10-20T00:00:00Z
status: in-progress
---

# 实施记录

基线 `6fb8ca5364cd885f5617878e5ea4901f903de3ff`，分支 `feat/executor-kernel-host-lifecycle`。

| Milestone | 状态 | 当前证据 |
| --- | --- | --- |
| M0 合同与映射 | 本地落地 | 公共 TS、Kernel IPC Schema、可移植正反 fixture；kernel-ipc-contract 实际请求验证；#51 外部交接待确认 |
| M1 Kernel/client | 本地通过 | 独立服务、attached client、完整身份/source replay；多客户端、ACK 丢失不重发、非法请求、源窗口回归 |
| M2 worker 监督 | 本地通过 | 主循环 IPC 心跳、先回收再替换、250/1000/4000ms 三次滚动预算；强杀、死循环、静默不误杀、预算耗尽与 Kernel 强杀恢复 |
| M3a 独立 Extra | 本地通过 | 独立子进程；停准入→取消所属 Run→dispose→断执行连接；兄弟 Run/Kernel 保持工作；失败清理阻止同名替换 |
| M3b 函数代理 | 本地通过 | instance/epoch/call ID 隔离；8 个取消后未结束 Promise 仍占额，第 9 个 BUSY；settle 后释放；宿主值 A→B |
| M4 Host SDK | 本地通过 | direct Core、attach、owned Kernel、独立 Extra；明确退出/清理结果；真实 Go binary argv/cwd/配置路径及停止 ACK |
| M5 CLI 与删除 | 本地通过 | 两组六动作、各自 service ID/install 锁、首次自启 false、重复保留；两前台进程互不维护；旧 daemon 源码、入口和 alias 已删除 |
| M6 验证 | 部分完成 | 全量构建、Node/UI、类型、本地包外消费；真实 Linux/Windows 服务及 IM 仍待验 |

本地验证阶段没有安装、停止或卸载用户机器上的服务。用户随后授权 commit、push、创建 PR 并合入 main；本次 Git 交付不包含 npm 发布或 registry deprecation。

## 已执行检查

本地环境 macOS arm64、Node v24.19.0。证据对应本 worktree 未提交代码，不能冒充已发布 SHA。

- `pnpm install --frozen-lockfile --ignore-scripts`：通过。
- `pnpm run build`、`pnpm exec tsc -p tsconfig.json --noEmit`：通过。
- `pnpm test:suites`：WebUI 35/35；Node 1255 项，1245 通过、10 跳过、0 失败。跳过不计通过。
- 真实 Go fixture 编译后验证空格、元字符保持 argv 原义，独立停止及不完整 ACK 不假成功。
- Kernel 故障：空闲超过心跳窗口仍存活，主循环阻塞被回收，连续三次替换后 unavailable，Kernel 强杀后显式新建实例且旧流不假恢复。
- 仓库外 tgz 首轮通过：空缓存 offline 安装、公开 TS 严格声明、Core/owned Kernel/独立 Extra/CLI Kernel、卸载保留 Home。最终检查结果追加于文末。

所有测试使用临时 Home 与本次创建的进程。

## 旧回归去向

旧 daemon 专属测试随删除的 API 退役，不能把删除的旧用例计为新合同通过。

| 旧入口测试 | 新入口证据 |
| --- | --- |
| daemon-ipc-disconnect / embedded-invoke | kernel-clients、kernel-worker-supervision、kernel-endpoint、host-sdk-lifecycle |
| daemon-modules / daemon-runtime-options | cli-components、cli-foreground、Kernel 无 Extra 依赖守卫 |
| sdk-host-extras / extra-sdk-disposal | host-sdk-lifecycle、extra-dependency-proxy；保留 extras/context-loader/im-extra-disposal |
| im-lifecycle-rpc | 旧业务 RPC 删除；通过 owned Extra 整体 stop/start，不公开内部 Bot 控制 |
| 旧 daemon 发行检查 | verify-release 最终 tgz 包外验证，Windows 共用入口 |

Core、Provider、Run7/Context v3、HostRunService/流预算、交互、进程组及平台 backend 回归继续执行。
旧账号切换集成场景没有逐项等价的新宿主集成证据，A23 保持待验。

## 尚未验收

- A30：Linux/Windows 真机 named pipe、原生服务管理器和后代回收。CI 已加入新合同测试，本地不能代替远端结果。
- Windows 目前依靠 taskkill /T 回收活着的受管进程；leader 已先退出时的后代归属/回收缺少 Job Object 级保证。这是 Windows 发布前需要解决的缺口，不能声称跨平台清理已完整达成。
- A31：具名外部 SDK 宿主、真实 Provider 与 im-test 业务闭环。本轮没有使用真实账号发送消息。
- A22/A23：所有启动阶段故障、账号/租户切换及旧回调迟到的组合矩阵仍需补齐。现有取消/超时/断线占额及清理失败测试只覆盖部分情形。
- #50 外部产品迁移、#51 Go client 对接不在本仓完成；公开 Schema/fixture 已随包提供。

不能把方案评分 96 分换算为全部功能验收通过。

## 最终本地复核

- 构建、类型、ESLint、命名、Prettier 和 `git diff --check` 通过。
- 最终源码对应 tgz 包外验证通过，结果为 offlineInstall/publicTypes/ownedKernel/independentExtra/cliKernel/uninstallPreservedHome 均 true。
- 最后增补的 CLI 已安装 start/restart 路由与就绪检查、端点恢复、Schema、Host 生命周期 9/9 通过；真实服务管理器行为仍按 A30 待验。
- 后续文档对齐已处理最后 9 处跨仓库失效链接，历史外部文件保留为明确注明缺失的源码路径；知识检查现已通过。线上架构来源仍因 octo-cli 无凭据待读取，见[对齐记录](architecture-alignment.md)。
- 原 main 目录干净，所有修改仅在本 worktree；本次测试进程已退出。

## PR 验证

- PR #61 首轮 Linux 构建/测试/包验证及 Windows 包与生命周期验证通过。
- macOS 首轮仅 native-component Go fixture 因 runner 缺少 go 失败；CI 已补充显式安装 Go 1.25.x，不跳过该测试。修复后的远端结果以 PR 检查为准。
