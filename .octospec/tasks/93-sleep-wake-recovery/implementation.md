---
type: Implementation
title: Issue 93 实施与验证记录
description: 按阶段记录实际完成、提交及未完成的事故和平台验收门槛。
tags: [testing, lifecycle, channel, ipc]
timestamp: 2026-10-22T00:00:00Z
---

# 授权与环境

用户授权实施，每个阶段独立英文 commit；保留 Git 作者 `superalsrk <lvsijia@mininglamp.com>`，每条提交追加一次 Codex co-author trailer。没有 push、PR、发布或修改运行中用户服务的授权。

本机：macOS 26.6.2 (25G83)、arm64、Node 24.19.0、pnpm 11.19.0。此为执行本任务的环境，不宣称是报告事故环境。独立 worktree 基于 `3b34415`，原 main 不改动。测试使用临时 endpoint/Home 与 fake Provider，不读取或重置用户身份和凭据。

| 阶段 | 状态 | 实际证据 |
| --- | --- | --- |
| M0 调查基线 | 文档与本地源码调查完成；事故现场门槛待外部信息 | F01-F17、H1-H6 已定位；reason12 有本地 IM 源码线索，但部署版本未核实；未执行真实一小时合盖 |
| M1 故障工具 | 隔离工具完成；真实 checkpoint 由维护者执行 | 真实 IPC relay 交叉矩阵、公共发行入口 native host 与 attach-only 探针 |
| M2 Gateway | 待实施 | 首次离线恢复、5/10/15/15 秒与状态日志接线 |
| M3 执行链 | 待实施 | 先复现监督时序，保留真实故障与未知执行边界 |
| M4 状态日志 | 待实施 | Extra 状态 stdout、日志镜像与 CLI logs |
| M5 双模式实测 | 待实施 | 隔离受控验证与真实平台结果分开 |
| M6 交付检查 | 待实施 | 全量回归、包外验证和剩余门槛 |

## M0

规划知识格式验证通过（296个OKF单元），上下文11条规则指纹通过；完整仓库知识检查仍只有既有 `docs` 目录断言冲突。已向用户请求报告构建、Provider/Adapter、专用测试Bot及部署版本；在等待时继续无依赖的隔离实现。

当前无法从报告确认原 Kernel listener、worker、Provider 或观察层的哪一层故障；不将候选监督时序修复冒充原事故根因。reason12 保留终态，除非后续证据支持安全区分暂态与有效 owner 替换。P0关闭仍受原验收合同约束。

## M1

用户补充：事故使用 npm 发布的 `1.1.0`，Provider 范围为全部，本地 Extra 配置有测试 Bot。部署 IM 版本仍未知。配置只用于后续本地受控试验，不把凭据写入证据或 Git。

新增 `kernel-recovery-matrix.test.js`：同一真实 Kernel 经 relay 丢 ACK 和订阅连接，验证一次 Provider start、连续完成，再交叉旧/新 client 与旧/新 session，检查 instance 和 worker generation 不变。复用已有半开/黑洞/worker 失联 fixture，不创建另一套协议。

`recovery-kernel-probe.mts` 与 `recovery-native-host.mts` 只使用公共包入口，探针不启动服务、不重试 invoke、不输出聊天正文。native 宿主直接持有 factory。没有自动切换网络、合盖或原生服务；原计划 live runner 延后到实际专用目标和人工 checkpoint 就绪，避免把配置存在当作真实试验成功。

验证：workspace build 通过；既有 invoke 27 项通过；新增交叉矩阵 1 项通过；两个公共入口工具 strict TypeScript 编译通过。fake Provider 结果不替代真实 IM/Provider 证据。
