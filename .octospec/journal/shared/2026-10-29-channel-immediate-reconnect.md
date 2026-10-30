---
type: Journal
title: 已确认断线后的立即重连验证
description: 取消上线后断线的首次固定退避，并记录本地验证与部署边界。
tags: [channel, lifecycle, testing]
timestamp: 2026-10-29T00:00:00Z
---

# 已确认断线后的立即重连验证

用户明确从 onDisconnect 回调起算，目标为尽快恢复，4 秒是估计值。实现同步退出 online，等待旧连接清理成功后零延迟调度首次重连；后续失败仍按 5/10/15 秒退避，首次启动失败保持原策略。重试次数与退避档位独立计数，成功后重置，保留 Retry-After、停止、迟到回调隔离和回收失败边界。

本地验证通过：

- Gateway 包构建：`pnpm --filter @mininglamp-oss/octo-runtime-extra-channel-gateway build`。
- 连接状态机、投递确认与 Extra 释放相关 113 项测试：`node --test test/im-connection-state-machine.test.js test/im-delivery-ack.test.js test/im-extra-disposal.test.js`。最终代码调整后已重新构建并重跑通过。
- 全仓 `pnpm lint` 与 `pnpm typecheck` 通过；最终计数器调整后再次运行 `pnpm exec tsc -p tsconfig.json --noEmit` 与修改文件 ESLint，均通过。
- `git diff --check` 通过；`.github`、`scripts`、根 package.json 与 pnpm-workspace.yaml 无变更，未扩大 CI。

本次未安装或重启现有服务，未进行 Git 提交。当前运行进程仍使用旧代码。本地测试验证的是回调后的调度行为，不代表切网至断线检测或远端握手有固定完成时限。此前单向无响应取证独立于本次修复，不应据此宣称 OH-RUN-2005 的全部成因已解决。

当前合同已同步至 channel-integration 规则及 SDK_CHANNEL_GATEWAY_GUIDE.md；任务范围见 `tasks/channel-immediate-reconnect/brief.md`。

## 2026-10-30：增加断线后的快速恢复窗口

用户指出收到断线回调时网络可能尚未恢复，要求先按 1 秒间隔重试 5–10 次再进入常规退避。采用立即一次、最多追加 10 次快速重试、再按 5/10/15 秒退避的策略。每次等待从前一次失败及清理完成后起算；Retry-After 仍优先，快速次数不占用常规退避档位。首次启动失败仍使用原退避；上线成功与显式启动重置快速次数。

最终代码重新构建通过，相关 115 项测试通过，覆盖完整快速次数及退避边界、成功后重置、网络在快速阶段恢复、停止取消快速定时器、长等待及休眠不补跑。全仓 lint、根 TypeScript noEmit、修改源码与测试的 Prettier 检查、git diff --check 均通过。CI 文件与入口脚本仍无变更；未安装、重启或提交，当前运行服务尚未应用本次修改。

## 2026-10-30：用户授权全局安装并测试

用户随后要求 build & install -g。全量构建通过，pack-release 在 npm 12.2.1 的 JSON 返回解析处失败，但 tgz 已生成。独立检查归档内 68 个生产依赖及其传递依赖均存在、bundleDependencies 一致、Gateway JS 与本次构建字节一致、build-info 一致后，使用 npm install -g 本地归档（offline、ignore-scripts、no-audit、no-fund）成功安装，未修改打包脚本。

升级前确认 6 个 Bot workingTasks/queuedTasks 均为 0，顺序停止 Gateway 与 Kernel，安装后启动 Kernel 与 Gateway。新 Kernel PID 89174，Worker PID 89175 ready；Gateway PID 89735，6 个 Bot 均 online/error=null，kernel_available=true。全局安装 Gateway JS 与本地构建 SHA-256 一致：9f407478dd1d2af249520cba339bc6c8eec9c567a11f9d20384a49331b6705e2。构建来源 8b239e47231d dirty，构建时间 2026-10-29T16:09:17.432Z（北京时间 10 月 30 日 00:09:17）。切网体验待用户实际验收，未代发消息或主动切换系统网络。

## 2026-10-30：补齐回调前的静默失联检测

用户直接从酒店 Wi-Fi 切换到手机热点后反馈仍等待约一分钟。日志证据：北京时间 00:23:04.628 OpenClaw IM_DISCONNECTED、00:23:04.630 retry_started、00:23:05.148 connected。先前修复已将回调至重试缩短至 2 ms，但没有检测操作系统网络切换；另一连接 00:23:52.573 由 IM_HEARTBEAT_TIMEOUT 才进入恢复。不能将没有切网时间戳的日志推导为精确的切网检测时长。

本次改为每 5 秒发送 WuKong PING，下一周期仍未收到 PONG 即标记连接不可用、清理心跳并 terminate，由 close 发出既有断线通知。普通协议流量不再刷新存活期限，解决单向失效仍被推送续命的检测缺口。未增加跨 Bot 联动、REST 心跳或操作系统网络监视器；正常调度下静默失联约 5–10 秒发现，不承诺点击切网即时收到 close，睡眠和事件循环停顿仍可能延迟。

Gateway 构建及相关 117 项测试通过，包括 5 秒探测加 5 秒等待边界、正常 PONG 多周期存活、持续 SENDACK/PING 不能掩盖缺失 PONG、关闭后不再回调。全仓 lint、根 TypeScript noEmit 与 git diff --check 通过，测试文件已用 Prettier 格式化；CI 范围不变。上线可用状态不代替用户切网验收。

沿用用户本轮安装测试授权完成全量构建及全局更新。pack-release 仍因 npm 12 JSON 结果形状不兼容在打包后的检查报错；同前独立核验归档依赖、构建信息与本次 Gateway/transport 字节后安装。构建时间 2026-10-29T16:27:29.571Z，Kernel PID 14985（Worker 14986 ready），Gateway PID 15100。6 个 Bot 在北京时间 00:28:38–00:28:41 上线，随后状态复查均 online/error=null，安装以来未记录 channel.disconnected。已说明当前仅增加协议探测，未实现 macOS 网络切换通知；IM_DISCONNECTED 不足以归因于云端主动关闭。

用户再次明确要求 build/install -g 后重新构建并安装，构建时间 2026-10-29T16:30:54.093Z。同前核验包的 68 个依赖及源码构建一致性，升级前 6 个 Bot 均空闲；安装成功后 Kernel PID 20233（Worker 20234 ready）、Gateway PID 20361，6 个 Bot 均 online/error=null。已安装的 im-channel.js 和 wukong.js 与构建逐字节一致。实现沿用 WuKong 二进制消息内的 PING/PONG，不是 WebSocket 原生控制帧；频率及超时判定由 Runtime 管理。
