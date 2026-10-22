---
type: Task
title: 跨平台 CI 生命周期竞态修复
description: 固定恢复 fixture 的启动结果，并保留启动取消用例的真实失败原因。
tags: [testing, ci, recovery]
timestamp: 2026-10-22T00:00:00Z
slug: ci-lifecycle-races
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39732869529/job/119671741690
---

# 跨平台 CI 生命周期竞态修复

## 目标与边界

基于最新 `main@88fa71d` 新建 worktree，修复阻塞 npm 发行的测试竞态，提交英文 PR 并按已有授权合入 main。
决定权属于工程测试；输入为用户提供的 CI 日志和当前测试合同。不改变产品策略、公共 API、服务拓扑、恢复退避或清理预算，不发布 npm 或修改版本 tag。

## 已确认问题

- macOS Node 26：恢复 fixture 先记录启动，再读取故障文件。父进程读到第五次启动便删除故障文件时，第五个 worker 可能直接就绪，导致预期第六次启动的断言失败。须先固定本次 blocked 结果，再发布记录，保留快速重试次数和两次 15 秒慢重试的验证。
- main 的另一轮 Windows Node 24：启动取消用例等待登记超时，原始 initialize 拒绝被吞掉，日志不足以判断是否为身份查询失败。传播原始错误和清理事实；Windows 将依赖原生身份查询的取消和清单测试放入独立串行步骤，减少进程密集测试的资源竞争，保留 10 秒查询、15 秒登记等待和 5 秒清理预算。不能据此宣称已修复未取证的生产问题。

## 验收

- 确定性复现 fixture 的通知/故障恢复交错，验证旧顺序失败、新顺序通过。
- Node 24/26 目标用例与完整回归，相关静态检查。
- PR 六平台/版本任务通过后再次验证；合并后核查 main CI。
- 结果与局限写入 journal，保留配置 Git 作者和 Codex trailer。
