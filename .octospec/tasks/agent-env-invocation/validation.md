---
type: Validation
title: agentEnv 与中断实施验证
description: 四参数调用、环境隔离、可定位中断和独立发行包的实测证据。
tags: [architecture, protocol, lifecycle, validation]
---

# 2026-11-08 本地验证

[规划](brief.md)准备评分为 96/100，不代表实现质量或真实 Provider 验收。本记录针对两个 worktree 的未提交修改，承接 Issue 328；没有提交、推送或发布。

## 实测结果

| 范围 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| Runtime 构建 | `pnpm run build` | 全工作区成功 |
| Runtime 回归 | `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js` | 1606 项：1545 通过、61 跳过、0 失败 |
| Runtime 静态检查 | ESLint apps/packages、根 tsc --noEmit、lint-names | 通过 |
| 双语文档 | `pnpm run docs:check` | 类型通过；37 对页面、75 Markdown、8 JSON、6 Mermaid、12 内置 Context 样例；4 项执行示例通过 |
| 当前文档链接 | tracked + untracked，过滤已删除文件后 auditDocumentLinks | 161 篇、1530 链接、35 锚点，0 错误 |
| Gateway 构建/类型 | `tsc -p tsconfig.json` / `--noEmit` | 通过 |
| Gateway 回归 | `node --test --test-concurrency=4 --test-timeout=20000 test/*.test.js` | 561 项：560 通过、1 跳过、0 失败；最终生产代码 tgz 重装后再次通过 |
| 实际 npm 包外消费 | Gateway `scripts/verify-package.mjs GATEWAY.tgz RUNTIME.tgz CLIENT.tgz` | 独立临时目录 npm install 成功、CLI bin/命令/配置/日志、公开类型、client 与真实 Kernel RPC、关闭注册保留 Kernel 均通过 |
| 独立复审 | Standards / Spec reviewer | 最终未关闭问题分别为 0 / 0；另行复跑相关专项通过，见 review |
| 变异测试 | 将 registry.rejected 的记录身份保护从 !== 反转为 ===，重新构建并跑专项 | 测试失败，变异被杀死；finally 恢复源码、重建后 5 项通过 |

回归含预提交 interrupt、同步句柄身份、冻结快照、旧句柄身份复用、未消费 return/throw 释放、ACK/断流边界、恢复正文/图片、凭据隔离和业务投递尾流。Gateway mock 严格验证四参数和 IPC v2；业务断言读取实际模型 parts，不把旧 Context 结构重新塞回 Runtime。

## npm 候选和复现

Runtime 保留源码版本 0.0.0，`node scripts/pack-release.mjs --version 2.0.0` 生成完整 Runtime 与独立 client 两个真实 tgz。Gateway manifest 使用 client ^2.0.0，完整 Runtime 仅为测试 devDependency。最初 file tgz 安装只为本地联调，最终 manifest/lock 不含 file 路径或本机地址。

Gateway 的 `scripts/lock-runtime-candidates.mjs RUNTIME.tgz CLIENT.tgz` 从两个 tgz 提取包元数据和真实 sha512，交给 pnpm update 两个显式包并使用 --lockfile-only 生成锁；临时仅对本次作用域提供候选元数据，最终下载地址为 npm registry，未伪造发布时间。没有手改 integrity。2.0.0 尚未发布，干净的注册表安装须先发布这些匹配候选；重新打包后必须重新生成锁并复验。

Gateway 包先显式 tsc 构建，再 `npm pack --ignore-scripts --pack-destination /tmp`，包外验证显式安装三个 tgz，不访问 Runtime checkout 私有模块。首次普通 npm pack 的 prepack 被本地 pnpm 依赖状态检查拦下，未将其计作成功；后续上述显式构建/打包和真实消费成功。最终锁生成脚本已实际执行成功；追加审查发现旧 install --lockfile-only 会复用同版本旧锁，改为定向 update 并校验输入 hash 后，独立审查者用不同字节的同版本候选确认两项 integrity 均正确更新。

## 限制

- 未验证真实模型、真实 IM、原生 Windows/Linux 服务或用户现有系统服务；Windows 凭据大小写覆盖为平台分支模拟。
- 包外 Kernel 使用受控 Adapter，证明包/IPC/资源所有权，不等于真实 Provider 兼容性验收。
- 旧 SDK 对象入口、contexts、cancelInvocation 和 IPC v1 均不兼容；需协调升级 Runtime/client/Gateway。
- npm 安装会安装依赖；重新安装或显式更新时按 ^2 范围解析，不会后台自动更新或跨 major。
- 历史删除文件仍可能被基于 git ls-files 的纯 cached 文档审计列出；本次审计过滤实际不存在的文件，同时纳入新增文档。
