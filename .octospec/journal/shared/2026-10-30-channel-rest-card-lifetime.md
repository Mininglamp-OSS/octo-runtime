---
type: Journal
title: REST 进度卡与单次 WS 取消信号解耦
description: 记录卡片冻结根因、回归验证和全局安装状态。
tags: [channel, delivery, lifecycle, testing]
timestamp: 2026-10-30T00:00:00Z
---

# REST 进度卡与单次 WS 取消信号解耦

用户切网后最终回复成功，但进度卡永久停在思考中。确认 CardSession 原先持有单次 WS signal 的 OctoConnector 与 ImDeliveryDispatcher；WS 清理将信号永久取消，后续 REST 请求及投递循环无法恢复，并非卡片协议要求 WS online。

进度卡现使用原 Bot 生命周期的 REST 客户端和投递器，沿用原 CardSession 的消息 ID、序号和终态屏障。单次 WS 关闭不取消卡片请求，REST 可达而 WS 尚未恢复时也能更新；Bot 停止仍取消。每次 HTTP 请求校验已经核验的当前身份，凭据或身份改变阻止旧卡继续出站。交互按钮及其轮询保持原生命周期，未迁移；REST 继续使用现有有限重试，不提供长期离线补投保证。

验证通过：

- Gateway 包构建、全量 pnpm build、pnpm lint、根 TypeScript noEmit、修改文件 Prettier、git diff --check。
- 6 组相关测试文件共 186 项全部通过：im-artifact-delivery、im-protocol、im-context-gap-wire、im-extra-disposal、im-connection-state-machine、im-delivery-ack。
- 原 Runtime 长任务回归现保留真实 CardSession/OctoConnector 和 HTTP 序列化：断线恢复后仅 invoke 一次，原卡变为 completed，最终文本经新 WS 发送。
- 新增 6 项卡片场景：没有新 WS 但 REST 可达、已重连、HTTP 在途时关闭 WS、Bot 停止取消、凭据改变拒绝、短暂 HTTP 失败后终态成功。校验只有一次创建、后续编辑原消息、card_seq 单调、终态不可被迟到进度覆盖。
- 测试使用模拟 HTTP/WS，未宣称用户真实切网复测已通过；日志在 /tmp/octo-runtime-rest-card-tests.log。CI 配置及入口脚本未改，未创建 Git 提交。

沿用用户本轮构建、全局安装和重启授权部署。打包脚本仍因 npm 12 JSON 返回形状在归档生成后报错；独立核验 68 个依赖及传递依赖、bundleDependencies、build-info 和 4 个 Gateway 编译文件后安装，未修改打包脚本。安装前确认 6 个 Bot 均空闲，按 Gateway/Kernel 停止、离线全局安装、Kernel/Gateway 启动的顺序完成更新。

构建时间 2026-10-29T17:29:28.042Z（北京时间 01:29:28），来源 8b239e47231d dirty。Kernel PID 8254、Worker PID 8255 ready，Gateway PID 8814；6 个 Bot 全部 online/error=null，kernel_available=true。安装后的 im-channel.js、channel.js、connector.js、wukong.js 与 build-info 均与本次构建逐字节一致。未代发消息、切换网络或修改用户配置。
