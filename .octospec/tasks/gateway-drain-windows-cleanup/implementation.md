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
M0原生机制通过，M1/M2产品实现与本地回归通过，M3接线已完成；最终平台及真实业务验收进行中。

## M0

- 新增Gateway受控回归：owner停止后，原调用signal必须保持可消费、尾事件和final必须先于connector关闭。原实现按预期失败，断言为`accepted invocation tail must survive owner stop`。
- 新增私有Go Windows Job：挂起创建、Job关联、句柄继承白名单、控制通道challenge、CRT fd映射、目标身份和active count清理确认。
- Node24/macOS完成workspace构建及x64/arm64交叉编译；交叉编译不计Windows执行通过。
- 首轮Windows原型握手超时；修正同步双向Pipe读写互锁为overlapped I/O。
- `3d56095`原生Windows Server2025/amd64、Node24、Go1.25.14：[CI 39426380604](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39426380604)全部job通过。原型5/5通过，既有Windows生命周期94通过/7跳过；Linux/macOS检查和离线安装通过。该结果仅属于当时原型，不能替代后续产品接线验收。
- PR68的既有Windows失败发生在PowerShell读取worker身份阶段；此问题不等于本原型测试已失败或已修复。

## M1/M2

- Gateway资源signal不再随owner停止立即撤销；同步停准入/准备/重试，取消已接纳调用并等待原订阅、绑定及final，最后释放连接。drain最多3秒，资源最多4秒，共用Host传下来的单调截止。
- Extra runner并发取消所属Run和dispose，二者完成后才断开执行连接；失败ref不再无条件清空。
- 本地Node24/macOS：build、lint、命名通过。57项focused回归通过，涵盖Gateway/WeCom/启动回滚/ACP/NDJSON/Kernel/Codex/ZCode。
- 独立Extra+真实Kernel/worker受控回归通过：Gateway消费cancel ACK后释放的已接纳session.update、唯一final、再关闭connector；兄弟Run与Kernel存活。fixture保留Core既有取消合同，不声称Provider在取消之后新生成的帧必然被Core转发。
- Gateway未知结果、投递失败和超时均拒绝close并禁止迟到保存/回复；排队消息没有新invoke。

## M3/M4当前实现

- Host Node/native、Kernel worker、ACP、NDJSON、Codex与ZCode已接入私有spawnManaged；ChildProcess仍代表broker，status/manifest使用真实目标PID和GetProcessTimes身份。
- 固定Go1.25.14交叉编译amd64/arm64；打包前及包外检查资源摘要和PE架构；Windows包外执行helper。
- Windows新增同步阻塞owner、挂起窗口拒绝resume、100次并发创建/清理与哨兵；扩大Provider回收测试，等待当前实现CI。

## 待完成

M3接线的原生Windows回归、M4最终tgz与API/全套检查、M5真实Windows和im-test联验。
真实业务使用用户指定的im-test和本机账号文件，记录中不得出现凭据或规则正文。
