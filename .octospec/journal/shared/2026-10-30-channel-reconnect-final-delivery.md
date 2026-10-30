---
type: Journal
title: 长任务跨连接最终回复修复与本地安装
description: 记录同身份当前连接接管未发送结果的验证和部署边界。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T00:00:00Z
---

# 长任务跨连接最终回复修复与本地安装

用户复现 sleep 30 秒期间切换 Wi-Fi，连接已经恢复，但最终回复仍显示 OH-RUN-2005。源码确认入站消息的 reply/replyFinal 闭包持有旧连接及旧连接取消信号；重连会更换 GatewayTransport，因此新 WS online 不能让旧闭包恢复。此结论通过确定性测试复现，未将用户提供的诊断编号当作已完整追踪的线上证据。

最终回复改为在每次尚未开始的文本或文件发送前选择当前连接，要求 Bot、API、空间、核验凭据和 Bot 生命周期保持一致。重连间隙每次最多等待 15 秒，支持停止和取消。上传与文件准备使用投递生命周期；已开始发送而确认未知的操作不跨连接重放，不重新执行任务。旧进度卡及交互按钮不迁移，仍遵循原连接生命周期。

本地验证通过：

- Gateway 包构建及全量 `pnpm build`。
- `pnpm lint`、根 TypeScript noEmit、修改文件 Prettier 格式化、`git diff --check`。
- 连接状态机、上下文缺口、Extra 释放、文件投递和发送确认共 157 项测试全部通过。测试日志：`/tmp/octo-runtime-reconnect-delivery-tests.log`。
- 新测试覆盖真实 ImRuntime/GatewayTransport 长任务跨重连仅执行一次、恢复间隙等待、文本与文件由新连接发送、停止取消、15 秒超时、凭据/Bot/API/空间隔离、已发送未知不重放。
- `.github`、`scripts`、根 package.json 和 pnpm-workspace.yaml 无变更；未扩大 CI，未创建 Git 提交。

沿用用户 build/install -g 的授权完成全局安装。pack-release 仍在 npm 12 返回 JSON 的解析处失败，但归档已生成；独立核验归档内 68 个生产依赖及传递依赖、bundleDependencies、构建信息，以及 im-channel.js/channel.js/wukong.js 与本次构建逐字节一致后，使用离线 npm install -g 安装成功。未修改打包脚本。

安装前确认 6 个 Bot workingTasks/queuedTasks 全为 0，顺序停止 Gateway 和 Kernel，安装后先启动 Kernel 再启动 Gateway。构建时间为 2026-10-29T17:10:09.244Z，来源 8b239e47231d dirty。Kernel PID 84095、Worker PID 84097 ready；Gateway PID 84259，6 个 Bot 全部 online、error=null，kernel_available=true。安装后的三个 Gateway JS 及 build-info 与本次构建逐字节一致。未更改配置或单独重启 OpenClaw。

这次验证包括本地自动化重现与服务启动检查；真实 Wi-Fi 切换期间长任务的最终投递仍待用户验收，未代发测试消息或主动切换系统网络。

用户再次明确要求 build & install -g & restart 后重新完成全量构建、归档独立校验与全局安装。构建时间 2026-10-29T17:16:48.588Z（北京时间 01:16:48）；打包脚本仍存在上述 npm 返回格式问题，68 个依赖及 Gateway 构建内容核验通过。停服前 6 个 Bot 均空闲，重启后 Kernel PID 89128、Worker PID 89129 ready，Gateway PID 89719；6 个 Bot 全部 online/error=null，kernel_available=true。已安装代码和 build-info 与本次构建一致。
