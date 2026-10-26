---
type: Review
title: PR 181 yujiawei 审查整改
description: 逐项处理验证工具的探针完成、等待、输入和环境边界，保留原意见与实际验证的区别。
tags: [testing, channel, lifecycle, documentation]
timestamp: 2026-10-26T04:50:49Z
---

# 基线与范围

审查来源为[PR 181 的 yujiawei review](https://github.com/Mininglamp-OSS/octo-runtime/pull/181#pullrequestreview-5647456719)，审查head为`b515aa0fe12dae26855f49201daf15659817d44a`。用户要求核对并修复，沿用本任务提交和更新PR授权；不执行合并，不自行撤销review。下表P1/P2沿用审查者分级，不将全部意见写成已复现产品故障。

修改只在恢复验证工具及其测试中。独立的`recovery-live-probes.mjs`供runner和回归共同调用，便于测试真实探针实现，而非复制一套测试实现。产品公共合同、服务拓扑、重试和Run语义不变。

# 逐项处置

| 意见 | 核对及修改 | 验证 |
| --- | --- | --- |
| P1 inspect完成状态 | Promise resolve后再reject不会改变已完成结果，未复现原描述的成功后失败。仍统一成功、错误、提前关闭和超时的一次完成路径，关闭连接及取消超时；验证JSON-RPC响应身份与完整帧 | 真实loopback TCP服务覆盖完整响应后关闭、分段响应、半帧关闭、坏JSON、错误ID、RPC错误及无响应超时 |
| P1 固定等待 | 去掉250ms后直接断言；按条件轮询并设置3秒期限。继承预加载测试也去掉350ms存活窗口，改为主线程/Worker真实fetch行为及故障事件确认 | worker使用预先abort的fetch，不发出网络请求；只允许主线程拦截，轮询确认drop事件 |
| P1 暂态异常 | 只读等待重试明确的连接/Kernel暂态码及CLI明确的network/rate_limited等错误。未知、鉴权、协议和断言错误立即抛出；子进程退出检查放在重试catch外；到期保留最后cause | 暂态错误后成功、连续暂态到期、fatal和owner失败立即返回测试 |
| P1 控制文件 | lstat拒绝链接/非普通文件，open使用可用的O_NOFOLLOW/O_NONBLOCK；在实际fd上校验类型、身份、group/other写权限和4096字节上限，再限量读取并验证blocked/drop。启动拒绝坏输入；运行中保留最后合法鉴权状态、暂停新drop、记录去重错误，读取失败按200ms至2秒退避，合法原子替换后恢复 | 无效JSON/schema、超大文件、目录、POSIX链接/可写权限、坏更新后鉴权状态保持与恢复测试 |
| P2 子进程环境 | 平台、代理、证书使用显式白名单；仅Kernel保留明确Codex配置，octo-cli与Gateway不继承Provider密钥、其他Octo身份及未知Node hook。Gateway仅注入本工具已知预加载 | 使用运行时生成的虚构凭据验证白名单隔离；真实CLI续接另行复跑 |
| P2 历史payload | 逐消息解析，跳过坏JSON、null和非文本content；合法消息保留原ID与发送者，唯一marker及UK同一回复校验不变 | 混合坏消息、普通对象及base64合法消息回读测试 |
| P2 Response依赖 | 仓库支持Node 24/26，其全局Response可用；本stub并不消费Response接口，直接返回最小ok对象，不新增依赖或polyfill | 原请求转发及故障隔离测试继续通过 |

# 验证状态

`node --unhandled-rejections=strict --test test/recovery-live-probe.test.js`共11项通过、零失败/跳过。包含真实进程、真实Worker和loopback socket，但不调用真实模型。八文件恢复集合首次57项通过，耗时36972.8毫秒；最终`2634d28`基线再次57项通过，耗时36472.0毫秒。`pnpm lint`、TypeScript no-emit、命名及全仓格式检查通过。知识lint仍只有7个已核对的主线frontmatter错误，没有新增链接错误；不沿用旧head的CI成功作为新head结果。

四项P1意见与三项P2建议均已有对应修改或事实澄清；review状态和main保护仍以GitHub为准。原两个P0的现场验收缺口继续保持开放。

# 第一轮真实复跑与提示边界

`cf1f45e6de6116c2432d70ed5aaf38bda3ada9dd`的SDK完整trial通过：`/tmp/or-recovery-live-TLFSZR/report.json`，04:52:29Z至04:54:15Z。CLI的`/tmp/or-recovery-live-SwT3iO/report.json`只通过前三项，在WS恢复后的direct续接以`QA_DIRECT_RESULT_INVALID`失败，两进程均完整退出。只核对该trial独占cwd的Provider session记录，两次执行均完成；基线回复精确匹配，续接回复包含相同marker但额外增加一个句号。没有把此trial写成通过或产品恢复失败。

原初始化提示中的marker后紧跟句号，现改为独占一行，并在初始/续接提示中明确不允许标点、引号或格式；续接提示仍不提供marker值。精确回复、Provider session ID和resumeOutcome断言保持，旧Run不自动重提。失败报告新增终态、是否精确匹配/包含marker、是否存在Provider session的布尔诊断，不记录实际回复或session ID。最终使用新trial重跑，不覆盖原失败结果。

# 最终真实验证及复审

最终代码基线`2634d28c7eea2bc9531b2ec578cf4af145839132`，两次开始时工作区均clean；Darwin/arm64、Node 24.19.0，测试站、账号、命令与[live记录](live-verification.md)相同。没有改产品源码，因此继续使用先前同一产品源码的构建产物，不把工具验证写成新的产品发行包验收。

| 模式 | 报告 | UTC 时间 | 结果 |
| --- | --- | --- | --- |
| SDK | `/tmp/or-recovery-live-eAnXLZ/report.json` | 04:58:30至05:00:24 | 九项恢复断言、UK同一回复回读、实际网页DM、服务身份保持及清理均PASS，exit 0 |
| CLI | `/tmp/or-recovery-live-R8lszO/report.json` | 05:00:47至05:02:51 | 九项恢复断言、UK同一回复回读、实际网页DM、服务身份保持及清理均PASS，exit 0 |

两个模式均仅一次drop且`sockets:1`，没有control_error；worker代次增加，旧Run返回`RUN_OUTCOME_UNKNOWN`且不重提。CLI环境白名单在本次Codex配置下通过，不推广为其他Provider/部署配置验收。两次trial凭据配置已删除，SDK无errors/pendingResources，CLI两进程exit 0，按独占目录及worker入口核对无残留进程。

SDK启动/WS恢复观察为17287/26053毫秒，CLI为17156/26092毫秒；仍是本进程故障解除后的观察，不能当作正式G02计时或生产SLA。

沿用verified-review串行复审本轮变更：检查新增探针入口及实际runner调用、成功/失败/超时资源释放、暂态与fatal边界、fd类型/权限/容量/身份校验、读失败状态、消息匹配与凭据输出，另逐文件核对测试及知识变更。没有medium及以上未处置问题；已知Low主线程限制仍有真实Worker回归。GitHub新head的CI及yujiawei复审另行确认，没有自行批准或合并。

本轮相对`b515aa0`的9个变更文件全部复审，没有跳过。整个PR的17个文件中9个OKF单元、11条规则指纹及本地链接检查通过；PR文件、英文PR正文及四次trial产物共45个常规文件与受保护Bot/UK凭据逐值比对，零命中。
