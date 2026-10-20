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
- Windows新增同步阻塞owner、挂起窗口拒绝resume、100次并发创建/清理、句柄数与哨兵；扩大Provider回收测试。
- `3cd3fde`的Windows Job/Provider步骤通过。后续原生组件测试暴露Job清空先于broker退出的竞态，不能把cleared当成processExited；`6b79493`已等待broker与stdio关闭，该SHA原生组件3项及Windows job通过。旧run超时及失败保留在记录中。
- Linux首轮发现异步spawn错误被PROCESS_NOT_STARTED覆盖，以及关闭测试仍依赖abort；`0cb54c7`修正并通过本地全套测试。

## M4/M5当前证据

- 干净`6b79493`在macOS arm64/Node24.19.0：typecheck、lint、命名、格式、UI35项，以及Node1289通过/18平台跳过；1307项无失败或取消。
- 同SHA最终tgz已完成包外离线安装、公开TS、owned Kernel、独立Extra、CLI Kernel与卸载保留Home检查。两架构资源和Go许可检查通过；不能由此推断原生arm64运行通过。
- im-test真实SDK与CLI均使用独立Gateway+独立Kernel+真实Codex0.154.0。工具开始后停止，SDK98ms/CLI109ms返回完整，立即回读唯一final，兄弟Run与Kernel存活，重新创建后再次真实回复。
- 相同真实连接与Provider上，在实际WebSocket文本发送边界注入拒绝：SDK621ms/CLI481ms返回未完成，重复stop保持失败，兄弟Run与Kernel仍可用；这是受控发送故障，不是服务端自然503。
- 私有关闭截止统一使用performance.now；框架公开Extra API、Context v3、Run 7及主包exports不变。
- `6b79493`三平台CI中Windows/macOS通过；Linux IM集成测试收尾挂起后主动取消。在Linux容器复现并修正终态后卡片/final未发完时撤销连接的问题，新增两个窗口回归；Linux容器11/11、本地加独立runner12/12通过。
- 此修正后工作区全量检查通过，UI35项、Node1291通过/18平台跳过，无失败或取消。真实IM再验SDK127ms/CLI141ms完成停止，final在stop返回时可回读，重新创建后再次回复。
- 最终代码`1d6104f`的[CI39434536989](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39434536989)三平台与CI Gate全部通过；Windows归属62通过/2跳过、生命周期94通过/7跳过，100次回收后句柄203→203。Linux/macOS全量与三平台最终包外验证通过；本地相同干净SHA的发行包亦通过离线安装和公开类型等检查。M4完成，后续仅回写此验收证据。
- 精确命令、平台和未验范围见[验收记录](../../journal/shared/2026-10-20-gateway-drain-windows-owner.md)。

## 待完成

Windows10/11真实Provider与实际宿主构建/重启；arm64原生执行；拒绝嵌套Job/Win32查询失败的故障注入。M5不能整体标记完成，不关闭#14/#30的更广范围，不关联无关#55。实现PR为[#72](https://github.com/Mininglamp-OSS/octo-runtime/pull/72)，main要求至少一名reviewer批准，记录时尚未获得，不能绕过保护规则合并。
真实业务使用用户指定的im-test和本机账号文件，记录中不得出现凭据或规则正文。
