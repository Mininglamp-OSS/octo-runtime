# 助理原任务观察与诊断

用户明确要求：两边同步即可，不发送“继续执行”之类的输入。恢复观察必须针对原任务、原 thread/turn，不能重放原请求或新起执行。

## 产品意图与职责

- 产品决定观察策略。Client 可显式使用当前 SDK 已支持的 `octo.execution/limits.model_idle_policy: observe`，使模型静默只留下诊断，不取消观察；工具/总期限和主动停止仍按原合同生效。
- Generic Runtime 默认 enforce 保持。Core 接收已经准备的单次请求，不替宿主查询产品私有 daemon，也不决定业务续接。
- Kernel 使用原身份/游标修复自己的源观察窗口；产品 Provider 代理的重订阅由 Client Adapter 显式适配。仍 running 时订阅原流，已结束时读取同一执行的真实结果，不重新 invoke。
- 代理退出与本地清理完成不等于真实执行停止。Adapter 仅以匹配当前 thread/turn 的原生终态报告停止；取消 ACK、乐观 run.cancelled、清理超时和代理退出均不补造停止证据。
- 日志只记录白名单安全测量及诊断编号，不记录输入、正文、原始错误、Context 或凭据。

## 本 PR 的最终范围

只增加通用真实停止/本地清理证据、安全 watchdog 日志，以及既有 enforce/observe 合同的同一执行验证。不增加业务执行策略或未来 SDK 准备逻辑。既有工具前 503/限流重试不属于本次需求，不改动。

## 产品接线与验收边界

配套 Client MR 使用当前固定 SDK 的 observe 合同与产品专属原任务订阅，不依赖本 PR 新版本发布或无关 SDK 大迁移。本仓不实现 OctoBuddy 私有 daemon 方法，也不声称本 PR 单独修复产品重订阅。

验收覆盖：模型静默 enforce 与 observe 的差异、同一输入仅执行一次、代理清理与实际停止分离、匹配 thread/turn 的真实终态、取消 ACK 不能证明停止、日志关联与隐私。真实 daemon + fake Provider 的隔离实验与真实 IM/模型联调分别记录；不是原事故复现。
