---
type: Review
title: Issue 265 双轴代码审查
description: 固定基线下 Standards 与 Spec 独立审查、修复和复核结果。
tags: [protocol, interaction, review, testing]
---

# 审查范围

PR 准备阶段按用户要求重新独立执行双轴审查。新固定点为最新 main `4a0f53b50723422d90f051944ae19eb28f60712a`，对象为该基线至当前工作区全部差异（含新增文件）。新结论如下；后文保留原实施阶段记录。

## PR Standards

发现 0 项，无需整改。复核 Gateway 成对过滤 async 交互且保留正文、同步等待和禁止重放事实；Schema、生成物、容量及错误转发均符合规则。reviewer 独立运行 native:check 与 Gateway/codec 手动专项，4 项通过；未扩大 CI。

## PR Spec

发现 2 项 P2，均已修复：

- 直接 Core 的已结束调用只抛错误文字。改为 INTERACTION_NOT_ACTIVE 并保留原描述；5 个完整链路场景都补充 Core 晚答错误码断言。
- 直接 Core 消费端与 Adapter 保存的原题共享可变对象。注册时对内部请求使用 structuredClone，使公开表单和原生消息快照不能修改投递依据；新增修改公开 messageId、题目 ID/title/options 后仍按原问题投递的回归。

修复后 Codex、native、公开 Core/Kernel 和 Gateway 定向 107 项全部通过。最终两个审查轴各 0 开放发现；Standards 本轮最高无，Spec 本轮最高 P2。完整最终命令与 PR 交付证据见 [validation.md](validation.md)。

# 原实施阶段审查

使用 code-review 技能，两个独立只读 agent 分别审查 Standards 和 Spec。固定点为 HEAD `0bcd89c528018ffd508ca8099c8ac9c6b88de35d`，对象为 `git diff HEAD` 加未跟踪的新实现/专项文件；没有实现提交，故不是空的提交区间审查。

Standards 依据仓库 AGENTS、CONTRIBUTING 与 context.yaml 中规则；Spec 依据已批准的 brief.md 和 #265。复核在修复之后执行，实际测试另见 [validation.md](validation.md)。

## Standards

初轮 3 项 P2，均已关闭：

- Schema 原先未表达非空白限制，导致 TS 与 Go/Python 不一致。补齐与 JS trim 相同的字符约束，新增显式手动 TS/AJV/Go/Python 共享字符串专项。
- 新校验器接受孤立 surrogate。复用 assertJsonValue，响应失败保留稳定错误码；正反 Unicode 边界验证通过。
- Schema 改动尚未同步 native 生成物。运行 native:gen/native:check，3 个受影响文件一致，既有权威 codec fixture 通过。

复核独立重跑 native:check 和问题 codec 专项，均通过；未发现剩余标准问题或需单列的代码气味。**开放发现 0，历史最高 P2。**

## Spec

初轮 3 项 P2，均已关闭：

- 明确 RPC 拒绝与 turn/completed 同批到达时，Promise 微任务晚于终态使拒绝被误判未知。加入同步 rejected 回调，补同批帧夹具，与成功接纳按同一观察顺序处理。
- 明确拒绝丢失原生诊断。Core 保留 cause；仅把数值 providerRpcCode 沿 worker/Kernel 传递为 provider_rpc_code，不把任意 Provider 正文复制到公共错误。公开 Kernel 手动集成验证通过。
- 公共错误合同不完整。Schema/类型/错误目录补齐，响应校验和失效 RunRef 具有稳定 code，Kernel 安全转发已验证的 code。

复核确认三项修复，未发现新的明确缺陷。QuestionResponse 定义负责形状；Adapter 持有冻结的原题，负责归属、漏题和顺序核对。**开放发现 0，历史最高 P2。**
