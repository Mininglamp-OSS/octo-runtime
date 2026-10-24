---
type: Implementation
title: Issue 51 三语言原生 Client 与 playboard 实施记录
description: 本仓 native 下三套 SDK/demo、macOS 双工具链和包外验证、真实 Codex 结果及未闭合验收。
tags: [protocol, schema, native, ipc, testing]
timestamp: 2026-10-24T00:00:00Z
---

# 本轮交付

第二轮精简：三语言共用去重规则图，等价校验节点由 1,067 减至 597；Rust union 的分支绑定改为单份宏实现，保留全部公开类型、变体及整数/opaque 数字语义。当前 native:check 只需 Node，manifest v2 对输入、生成器及各产物字节做完整性检查；重新生成仍明确要求 gofmt/rustfmt，完整生成一致性另由测试验证。新增空 PATH 检查、不同数值约束和递归引用去重回归；未接入 native GitHub CI。

2026-10-24 最新范围：保留完整三语言 SDK 和 demo；删除复制客户端的模板，客户端/生命周期在各语言包只维护一份源码。模型只生成公共根及类型依赖，验证专用节点保留在规则表；Rust 校验器使用与 Python 共用的规则 IR，替代逐节点展开函数。Native 的 GitHub Actions job、CI Gate 接入、Gate 负例测试和根格式检查接入全部删除；只保留按需本地验证。下文的模板/CI 结果是此前实施历史，不构成当前交付要求。

PR 复审的两项缺陷已修复：Python Unix 关闭会中止未发送缓冲，避免超时或 client.close 无限等待；Rust union 在绑定前按 schema 选择分支，完整保留 message/tool/interaction subject 的 id。新增真实非读端缓冲阻塞测试，以及 ActivitySubject、嵌套 activity、三类 HostFrame、MCP 和不透明数字的类型往返测试。

精简后本机 Go race、Rust 全 target 单测、Python 6 项 transport 单测、生成器确定性/漂移回归通过；三语言真实 Kernel/fake Provider、demo、包外消费完整套件各 44 项通过，每语言 347 条协议样例，零失败/跳过。Linux/Windows 不据本机结果宣称通过。此前托管矩阵的结果仅属于旧版提交。

Go、Rust、Python 三套原生客户端和 playboard demo 均位于当前 worktree 的 `native/`，按用户最后的要求不使用外部 demo 仓库。统一支持 status/list、输入 JSON 或 prompt、native/canonical 流、原回执、get/subscribe、取消、两类回复、等待人工回答和显式回答文件。

代码入口：[Go](../../../native/go/examples/playboard-demo/main.go)、[Rust](../../../native/rust/examples/playboard-demo.rs)、[Python](../../../native/python/examples/playboard_demo.py)。统一操作见 [demo README](../../../native/examples/README.md)；生成和 SDK 所有权见 [native README](../../../native/README.md)。

工作树 `codex/51-native-rpc-clients`，基线 `445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`。未 commit、push、创建 PR、发包或关闭 issue。规划 96 分仅指可执行准备度，不是实施完成比例。

# 代码审查修复

本轮六项审查问题及 Rust 同构取消路径已修复，新增确定性 ACK barrier、整数 token、分块大行及 Windows 最终回收回归，见[修复记录](review-fixes.md)。下面的六工具链 39 项是初始实施历史；修复后的验证单独记录。

后续复审四项已修复；按用户要求把 Python Windows/Unix 异步传输统一在 `transport.py` 内，删除独立 Windows 模块，SDK 包和公开导入入口不分平台。具体回归及证据仍统一记录在上述修复记录中。

# Main 同步与 PR 交付

用户明确授权提交、同步最新 main、创建 PR 并合并，包发布仍未授权。分支已 rebase 到 `main@8214292`，知识目录/变更记录保留双方条目，发行测试同时保留 main 的 Windows 40 秒超时和 native CI Gate 依赖，新增 setup-go 沿用 main 的固定 v7 SHA。

同步后重新安装锁定依赖并构建、类型检查通过；Node 全量 1745 项中 1705 通过、40 个既有 skip、0 失败，UI 35 项通过；三语言完整原生套件各 44 项通过，均含 347 个协议样例及各自 demo/包外安装。生成漂移、lint/names/docs/format 检查通过。首次本机全量测试误与清理构建并行，产生缺少构建产物的失败；上述最终结果为构建完成后的独立重跑。

英文 [PR #129](https://github.com/Mininglamp-OSS/octo-runtime/pull/129) 已创建。首个托管扫描把 Python 的两个 Schema 字节/长度约束名误判为 generic-api-key，局部变量改名为 extension 后重扫。主分支保护要求 CI Gate 成功及一位 reviewer 批准，管理员同样受约束，仓库未开启自动合并；远端合并状态以 PR 为准，不以本记录代替 GitHub 确认。

# 实测结果

本机 macOS arm64，每语言最低/当前工具链分别执行 `native/tests/run.mjs --language <language>`，每格 **39 项通过、0 失败、0 skip**，含 339 个协议样例：

| 语言 | 最低工具链 | 当前工具链 | 包外消费 |
| --- | --- | --- | --- |
| Go | 1.25.0 | 1.26.1 | 标准 module zip → 临时 file GOPROXY → 空 module cache → 独立 CGO_ENABLED=0 binary |
| Rust | 1.85.0 | 1.98.1 | cargo package → 解包至仓外临时目录 → 编译 example |
| Python | 3.11.16 | 3.14.7 | sdist 构建 wheel → 新 venv 安装 → 仓外 demo |

包外测试客户端 `PATH=""`，Python 额外 `-I`、清空 PYTHONPATH 并核对 import 来自新 venv；三语言都实际 list、native/canonical 调用和原回执 get。服务由测试宿主启动，使用真实 Kernel/隔离 worker + fake Provider。

故障覆盖：原 invoke ACK 丢失只 get、不重提，无法确认时保留 unknown；两次订阅断线按原游标恢复；业务错误保留；cancel/两类 respond ACK 丢失不重发；重复 cancel 共享；观察结束不取消、兄弟客户端仍可查；drain 不新增订阅；真实杀死测试 worker 后 native/canonical 均报告 RUN_OUTCOME_UNKNOWN。

真实 Provider 单独执行 `native/tests/live-demo.mjs --endpoint <existing socket>`：Go、Rust、Python 各跑 Codex native/canonical，共 **6/6 正常完成**，每次又用原 ref 查到 completed。Codex 版本 `0.154.0`；测试宿主所安装 CLI 为 `1.1.3`、commit `fe19d3504315`、build `2026-10-22T15:06:34.025Z`，该 CLI 元数据不等价于额外证明服务进程加载的 commit。现有 Kernel instance 与各次回执见 [证据 JSON](evidence/macos-2026-10-24.json)。未启动/重启/停止现有服务。真实审批/追问和真实 Provider 取消尚未覆盖，自动化交互/取消不能代替这些结果。

其他本机检查：Go `go test -race`、Rust clippy/fmt、生成确定性/漂移/未知关键字失败、CI Gate 负例、TS lint/names/typecheck/docs/format 及相关协议/发行测试。TS 全量回归结果见证据。Go Windows amd64 交叉编译另记，仅为编译证据。Rust 的 url/idna 依赖已固定兼容 1.85 的后端，避免最新传递 ICU 把最低编译版本提升到 1.88。

# 验收追踪

“已有”表示列出的本机断言通过；凡有剩余项即不把该 A 项记为完整通过。

| ID | 已有证据 | 剩余项 |
| --- | --- | --- |
| A01 | 八方法、具体 params/result/envelope、真实 IPC | 全部强类型 union/allOf 构造器审计 |
| A02 | 339 样例及 TS 对照新增 6 样例 | InvokeInput/ModelInputPart 全字段逐分支等价 |
| A03 | 原 fixture、Go opaque/null roundtrip、可选字段代码 | 三语言完整三态 roundtrip 矩阵 |
| A04 | 原 fixtures，加 `1.0`/`1e0` 的 typed binding、RPC 与帧身份回归 | 所有整数槽位的完整边界组合 |
| A05 | RawMessage/serde arbitrary_precision/Decimal、Go 大整数测试 | 跨语言所有 opaque roundtrip 与 TS 数值差异专项 |
| A06 | strict Unicode codec 和部分样例 | byte relay 多字节拆包、CRLF 全矩阵 |
| A07 | 开放对象与严格 ref 的原 fixtures | 各业务边界扩展全量变体 |
| A08 | envelope 校验、未知错误注入 | malformed/raw-byte/batch 全矩阵 |
| A09 | 本机重复生成完全一致 | 三 OS 生成比较 |
| A10 | 变更小 Schema 的字段/方法生成测试 | 行为参数变更全分支断言 |
| A11 | 改/删/遗留文件、未知关键字无部分写入、Gate 负例 | 托管 CI 实际失败门禁证据 |
| A12 | 三语言仓外安装/运行、空 PATH | 跨平台执行 |
| A13 | lazy registry、真实 status/list/invoke | 消费前零连接独立计数 |
| A14 | native 正常终态、真实 Codex | text/image/env 组合完整捕获 |
| A15 | canonical 正常终态、worker lost | Provider failed/cancel 全部 canonical 组合 |
| A16 | ACK 丢失 invoke/start 各一次、原身份 get | 部分写入 byte barrier |
| A17 | acceptance unknown、身份/instance 错码 | 真实服务重启与 pending ACK 组合 |
| A18 | 两次断流、连续 seq、原 after_seq | 跨平台执行 |
| A19 | gap/expired/cursor 错码保留 | 真实 TTL/淘汰和恢复总预算边界 |
| A20 | 原 ref/instance 校验 | 每个身份字段 × 每个控制方法变异 |
| A21 | 实现 identity conflict | 重复 Run/RPC id 专项计数 |
| A22 | 写前取消代码 | status/connect/write 精确 barrier |
| A23 | 独立取消 admission 设计 | ACK pending + deadline + ACK loss 联合竞态 |
| A24 | cancel ACK 丢失 unknown、不重发 | 跨平台执行 |
| A25 | 观察关闭不 cancel、兄弟客户端可查；pending admission close/drop barrier | 100 次资源统计 |
| A26 | 两类回复、第二 CLI 回答、Codex 双通知一次回复 | 权限/过期/错 mode 全部反例 |
| A27 | 两类 respond ACK 丢失 unknown、不重发 | 同时取消竞态 |
| A28 | 真 worker kill、两种模式 lost | terminal 后帧、无终态 EOF byte 专项 |
| A29 | fast terminal 保存回执、独立 get | 缺历史与 after=latest 全组合 |
| A30 | 现有正常取消与 source 错误分支 | 精确同时发生的 barrier 矩阵 |
| A31 | 字节上界实现 | 两个阈值 ±1、partial write 原始字节证明 |
| A32 | 按需读、有限缓存实现 | slow-reader 高水位与兄弟调用压力 |
| A33 | 32/128/4 容量实现 | 全部真实饱和边界计数 |
| A34 | drain 完成、不增订阅、缓存首次 deadline | 16 paused streams、deadline 后 I/O 专项 |
| A35 | close/overlapped completion 实现 | Windows 实机及 100 次清理增长检查 |
| A36 | macOS 三语言最低/当前版本 | Linux/Windows 六个平台格子待 CI |
| A37 | macOS 六工具链格子和三种包外消费 | Linux/Windows 最低/当前版本 |
| A38 | TS 回归、18 格 CI 配置、Gate 负例 | 托管 CI 全矩阵及 npm 包门禁本轮实跑 |
| A39 | 三语言原生 demo 与中文 SDK/CLI 文档 | 双语用户文档及全部接入边界审核 |
| A40 | 三语言真实 Codex，native/canonical 六次完成 | 真实审批/追问与取消 |

因此本轮“各语言 demo 在 native 内实施并验证”的目标已经落地；整个 Issue 51 的 A01-A40、M0-M7 **保持实施中**。不以新增 CI 文件或本机成功代替未获得的平台/压力证据。

# 复用结论

- 快速终态可能先于消费者取 registry 发生；demo 必须持有原始调用 key，必要时用原 instance 的 get 保存 receipt，不能依赖 registry 永远存在。
- 原生 request 与 control.pending 可以描述同一次交互；回答文件按原请求 ID 去重，没有显式答案时等待人工输入。
- Go module cache 目录是只读的；包外测试用限定到本次临时 cache 的 `go clean -modcache` 清理，避免 after hook 失败阻断 Kernel teardown。
- Python Task.cancel / Rust Stream drop 不撤回已写出的 admission；登记需保留观察关闭事实，后到回执不能把 phase 错改成仍在观察。

完整 OKF lint 的三个 systemd-directive-paths frontmatter 缺失是基线问题，未修改无关文件；本任务新增记录单独校验。
