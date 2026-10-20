---
type: Implementation
title: Gateway drain 与 Windows Job 实施记录
description: 区分已复现、原型、产品接线和平台/真实业务验收。
tags: [lifecycle, windows, testing, channel]
timestamp: 2026-10-20T00:00:00Z
status: in_progress
---

# 当前进度

用户已关闭规划PR #68，分支本地/远端重命名为`feat/gateway-drain-windows-cleanup`，并明确要求按计划实施。
M0进行中；尚未宣称两个P1修复完成。

## M0

- 新增Gateway受控回归：owner停止后，原调用signal必须保持可消费、尾事件和final必须先于connector关闭。原实现按预期失败，断言为`accepted invocation tail must survive owner stop`。
- 新增私有Go Windows Job原型：挂起创建、Job关联、句柄继承白名单、控制通道challenge、CRT fd映射、目标身份和active count清理确认。尚未接入产品launcher。
- Node24/macOS完成workspace构建及x64/arm64交叉编译；交叉编译不计Windows执行通过。
- Windows机制测试覆盖IPC往返、Unicode/参数/cwd/env、leader先退、owner先退、杀broker、原始stdout和重复清理；等待原生Windows CI结果后决定是否进入产品接线。
- PR68的既有Windows失败发生在PowerShell读取worker身份阶段；此问题不等于本原型测试已失败或已修复。

## 待完成

M0机制门、M1/M2 Gateway与runner接线、M3全部Windows launcher、M4最终tgz与API检查、M5真实Windows和im-test联验。
真实业务使用用户指定的im-test和本机账号文件，记录中不得出现凭据或规则正文。
