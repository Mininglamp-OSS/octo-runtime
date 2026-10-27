---
type: Task
title: CodeBuddy 202/203 实施与验证
description: 记录回归证据、Kernel 公共入口验证及未执行范围。
tags: [adapter, protocol, testing]
---

# 实施结果

2026-10-28，基线 `aac7ec7765ec055eff02328babefcf5d719c0c6a`，macOS arm64 / Node 24.19.0 / 项目 pnpm 11.19.0。
完整方案已先追加到 [#202](https://github.com/Mininglamp-OSS/octo-runtime/issues/202#issuecomment-6449817635) 与 [#203](https://github.com/Mininglamp-OSS/octo-runtime/issues/203#issuecomment-6449818563)。

生产改动仅涉及 CodeBuddy adapter：

- 新建和续聊回执均只包含原生响应确认的模型；未知时省略。usage 同样不再输出 model: undefined。
- 解析 Provider 私有失败元数据，缺失/损坏正文仍失败；保留脱敏中文消息和白名单内的 RPC/HTTP/Provider code、category，配额证据优先于普通 429 限流。
- 失败优先于部分输出和空输出守卫；空/空白/思考/仅工具不能成功。支持的结果正文仅补无流式 final 的成功；取消继续返回 cancelled。
- 失败/取消关闭未终结工具和步骤，client 的原有关闭归属不变；Core/Kernel 及公共协议未修改。

## 验证证据

修复前在独立 worktree 构建基线后执行新增用例，确认默认模型 Kernel 源帧包含 HOST_FRAME_INVALID、Host failed；直接 adapter 的订阅拒绝仍产生 run.completed。测试准备阶段纠正了内部 InvokeRequest 必须带 agentConfig、公共 submit 返回 ref 等 fixture 使用方式，未为这些测试准备问题修改生产层。

修复后新增测试 **37/37 通过**：

- 默认/空/显式 agentConfig，确认/未知模型的新建与恢复，不把未应用请求值或旧 binding 写入回执；对原始 payload 直接调用 assertJsonValue，不经序列化移除 undefined。
- Core 正常/订阅/部分输出后失败/空/空白/仅思考/仅工具/取消；检查唯一 canonical terminal、Host terminal 和传输关闭。
- 捕获的订阅错误保留完整中文续费说明、HTTP 429、Provider code 14015、quota，公共分类为 OH-PRV-4004 且 retryable=false；普通 429 为 OH-PRV-4005。
- 缺失、损坏、null、数组、数字及对象错误正文安全失败；运行期生成的非功能性敏感值被脱敏，未知 metadata/header/request/details 不进入公开证据。
- 三种结果正文载体、不重复已有流式文本、失败时不补结果正文、失败与取消优先级及 usage JSON 安全。
- 真实 createKernelService 在当前进程构造、内部独立 worker 注册 adapter，attachKernel 经实际本地 IPC 执行 submit/subscribe/get 和 invoke。正常默认模型、订阅拒绝、部分输出拒绝、空/思考输出和取消均核对 canonical 与 Host 终态；订阅错误经 IPC 后仍保留中文消息、14015 与非重试配额分类。

| 检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 通过，无依赖及 lockfile 改动 |
| pnpm build / pnpm typecheck | 通过 |
| CodeBuddy 最终单独 tsc 构建 | 通过 |
| 新增专项 test/codebuddy-outcomes.test.js | 37 通过，0 跳过 |
| 专项 + adapters/acp-message-segments/adapter-tool-lifecycle | 102 通过，1 跳过 |
| pnpm test:suites / Node | 2070 通过，56 跳过，0 失败 |
| pnpm test:suites / WebUI | 35 通过 |
| pnpm lint | 通过；首次与清理式构建并发导致缺失 dist 的误报，待构建完成后重跑；真实新增 unknown 收窄错误已修复 |
| pnpm lint:names | 通过，findings=[] |
| pnpm format:check | 通过 |
| pnpm docs:check | 类型、文档约束及 4 项运行测试通过 |
| OKF lint | uv run --with pyyaml python .octospec/scripts/lint.py 通过；系统 Python 缺 PyYAML，使用隔离 uv 环境，不改项目依赖 |
| git diff --check / 协议生成文件及 lockfile drift | 通过 |

## 自查与边界

按方案逐项核对 diff：修改归 CodeBuddy 原生适配，不放宽 Host 校验，不增模型默认/切换、账号探测、续费、重试或会话重置。公开消息使用既有脱敏函数，结构化 evidence 只投影白名单；没有凭据或原始 Provider 元数据入库。37 项新增用例已纳入现有全量入口。

上述 Provider 数据均为离线 fixture，Kernel/worker/IPC 为真实组件。未运行真实 CodeBuddy CLI/账号、外部 Work App/Electron 或真实 IM；没有据此声称已复测用户真实企业订阅。Linux/Windows 原生执行与托管 CI 状态以 PR 为准。没有部署、发布或合并。
