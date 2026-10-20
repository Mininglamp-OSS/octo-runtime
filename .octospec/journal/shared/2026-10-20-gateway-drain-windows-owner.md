---
type: Journal
title: Gateway drain 与 Windows Job 产品接线验收
description: 记录真实IM、跨包回归、包外运行及尚缺的平台证据。
tags: [lifecycle, channel, windows, testing, sdk]
timestamp: 2026-10-20T13:40:00Z
status: in_progress
---

# 实现与源码

工作分支为`feat/gateway-drain-windows-cleanup`，基于main的`fae6333`。规划PR68已关闭；本记录不表示它曾包含实现。`6b79493909ed80b40e75b35b1747d1939e14408f`包含Gateway drain、全部owned launcher的Windows Job接线、原生关闭竞态修正及真实IM验收脚本。后续提交统一runner外层的单调截止，并修正终态之后卡片/final仍在发送时的连接提前撤销，公开API不变。

Gateway停准入后保留原调用消费及投递，最多3秒drain、4秒共享清理；失败保留归属。Windows目标在挂起时进入不可breakaway Job，再恢复入口；leader先退仍清理Job，active count=0确认后代已回收，组件另等待broker/stdio关闭。机制及不覆盖的外部服务见[native说明](../../../native/windows-process-owner/README.md)。

# 本地与发行包

环境：macOS/arm64，Node24.19.0，pnpm11.19.0，Go固定1.25.14。下列产品检查及发行包基于干净`6b79493`：

```sh
corepack pnpm@11.19.0 typecheck
corepack pnpm@11.19.0 lint
corepack pnpm@11.19.0 lint:names
corepack pnpm@11.19.0 format:check
corepack pnpm@11.19.0 test:suites
node scripts/pack-release.mjs
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 6b79493909ed80b40e75b35b1747d1939e14408f --require-clean
```

结果：类型、lint、命名、格式通过；UI35/35，Node1289通过、18平台跳过、0失败/取消，共1307项，Node部分31.5秒。跳过不计Windows通过。包外离线安装、skipLibCheck=false公开类型、owned Kernel、独立Extra、CLI Kernel、卸载保留Home全部通过；包内两架构PE/摘要及Go许可通过。

终态后连接修正后的待提交工作区再次完成typecheck、lint、命名、格式和OKF检查；UI35/35、Node1291通过/18平台跳过，共1309项，0失败/取消，Node部分30.6秒。两项新增回归不改变平台跳过口径。最终提交需重建并验证对应干净SHA的发行包。

# 真实IM

用户指定`https://im-test.deepminer.com.cn/`及受保护账号文件。脚本以临时CLI Home使用两个明确授权的User Bot，只复用二者均加入的`Channel_QA_`群；记录只保留群指纹`d010c2b3cd5a`。不输出token、账号ID、消息正文或规则正文。

```sh
node scripts/verify-gateway-drain-live.mjs --inspect
node scripts/verify-gateway-drain-live.mjs
node scripts/verify-gateway-drain-live.mjs --cli
node scripts/verify-gateway-drain-live.mjs --fail-delivery
node scripts/verify-gateway-drain-live.mjs --cli --fail-delivery
```

每条命令由调用方设置`OCTO_CHANNEL_QA_ACCOUNTS`指向受保护文件，不把凭据放入命令参数。环境为上述macOS/Node，真实Codex CLI0.154.0。SDK使用独立Extra与Kernel、宿主loadContexts；CLI使用真实前台Gateway与同一指定Kernel。兄弟Run通过独立已接纳调用观察隔离。

| 场景 | 实际结果 |
| --- | --- |
| SDK工具开始后stop | 98ms，complete=true；立即回读唯一final；真实terminal；兄弟Run和Kernel保持可用；重新创建后再次真实回复 |
| CLI工具开始后SIGTERM | 109ms，成功退出；同样有唯一final、真实terminal、兄弟隔离与重新创建回复 |
| SDK实际发送边界注入拒绝 | 621ms，complete=false，重复stop仍失败；真实Provider/连接，final发送尝试1次；兄弟与Kernel可用 |
| CLI实际发送边界注入拒绝 | 481ms，失败退出，重复stop仍失败；发送尝试1次；兄弟与Kernel可用 |

故障注入针对实际WebSocket sendText边界。最初REST拦截没有命中文本路径，该次结果不算故障验收通过；改到实际边界后两入口均通过。该结果不声称服务端实际发生过503。独立runner受控测试另验证cancel ACK→尾binding→唯一final→connector.close的顺序；真实IM回读证明stop时已存在最终消息，不额外虚称抓取了服务端断链的精确时间。

终态后连接修正的工作区重复真实联验：SDK127ms、CLI141ms，两者再次确认真实工具已开始、终态、stop时唯一final、兄弟/Kernel隔离和重新创建后回复；SDK发送故障468ms、CLI549ms，仍报告incomplete且仅尝试1次。

# CI与未验项

`3d56095`的[CI39426380604](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39426380604)全部通过，但仅是原型。`3cd3fde`的[CI39428394531](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39428394531)Windows Job/Provider步骤通过，原生组件步骤暴露cleared先于broker退出而错误报告processExited的竞态，之后超时；Linux两项失败已修正。macOS该轮收到runner shutdown信号，不记为断言通过。`0cb54c7`的中间run因后续修正已主动取消。

`6b79493`的[CI39431785904](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39431785904)：Windows与macOS job通过，包含最终tgz。Windows扩大步骤62项中60通过/2跳过，生命周期101项中94通过/7跳过；原生组件3项通过，100次创建回收后句柄203→203。Linux在IM集成测试收尾挂起，该轮已主动取消以取得日志，不记为全绿。

使用官方`node:24.19.0-bookworm-slim`容器在Linux/arm64复现：终态到达后活动任务表已空，但`session.tail`仍在发送，close误判空闲而撤销连接，导致IM_DELIVERY_UNKNOWN。修正为在线连接统一在drain后撤销；新增卡片结束和final发送两个精确窗口回归。测试fixture改为finally释放其WebSocket/HTTP资源，保留原失败。容器IM与drain回归11/11，本地加独立runner回归12/12通过。该Linux容器证据不代替Windows或CI amd64结果。

尚无原生Windows10/11桌面、arm64机器、实际客户应用构建/重启结果；Codex与Claude在Windows桌面的真实Provider回收仍待验证。拒绝嵌套Job/Win32查询失败的故障注入未执行；100次创建回收与哨兵不能代替所有资源故障分支。Windows Server/amd64结果、交叉编译和平台跳过分别计数。M5整体仍未完成，#14/#30更广验收和无关#55不自动关闭。

95分是原开发计划的可完成性自评，不是实现完成率或真机验收得分。后续验收不能通过降低[原矩阵](../../tasks/gateway-drain-windows-cleanup/acceptance.md)要求补齐分数。
