---
type: Plan
title: Issue 51 三语言交付执行计划
description: 为每个阶段固定修改位置、输入、输出、完成门槛与失败处理，给出生成及互操作命令目标。
tags: [architecture, protocol, schema, ipc, native, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 执行顺序与边界

`M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7`。M3 先完成 Go 的端到端纵向切片，以真实 Kernel 校验生成设计，再扩展 Rust/Python；不能等三份代码全部写完才验证 wire。每阶段先通过本阶段验收，再扩大范围。阶段拆分不授权多 Agent、commit、PR、merge 或发包。

本任务实施者负责 M0-M7。平台维护者仅在实施环境缺失时提供相应机器/runner；真实 Provider 的凭据和目标由部署维护者提供。未指定自然人或日期，不虚构人员和排期。验收角色按 [acceptance](acceptance.md) 的断言独立核对。

## M0：冻结可生成合同

输入：[Issue #51](https://github.com/Mininglamp-OSS/octo-runtime/issues/51)、本任务 design、main 的 `client.ts/server.ts/invocation-lifecycle.ts/host-run-service.ts`、Protocol Schema 与运行时 checker。

1. 记录执行时 HEAD、issue 正文差异、工作树和依赖工具版本；后续 main 变化先检查 Protocol/Kernel 重叠 diff，不从其他未合并任务目录取实现。
2. 新增任务 `contract-diff.md`：从 InvokeInput 的每个 declared 字段和 checker 分支建立 field→Schema→TS 类型→fixture 对照；列出所有八方法的 params/result/notification/error。定位 `HostedAdapterMetadata` 在 `executor-core/src/index.ts`、关联 `AdapterMetadata` 在 `adapter-sdk/src/index.ts`，不新增能力标签目录。
3. 补 `protocol.schema.json` 与 `kernel-ipc.schema.json`，新增 `kernel-client.behavior.json/kernel-ipc.md/kernel-client-scenarios.json`。数据仍只维护在 schema 目录；补生成 source manifest，所有定义可达、method/result 明确。
4. 先以 Ajv 和 TS checker 对照 fixture；修正 Kernel integer 安全上界、RPC ID UTF-8 字节长度、null/presence、raw JSON 和实际返回 envelope 的描述差异。新精确 Schema 必须接受当前合法请求与回执；发生现有 checker 行为变化时记录影响，不能隐藏在生成器里。
5. 提取现有容量与恢复参数为共享行为源，TS 侧校验/复用其生成常量，保持既有 3 次/10 秒等预算；行为源 revision 与 IPC major 分开。
6. 在三个工具链的最低版本和 Windows wheel 条件下验证依赖候选，固定 lock 和 toolchain 清单。依赖仅在 native 包内。准备最小 Windows pipe transport spike 验证连接、跨 chunk 读取和取消 I/O completion。
7. 更新 `protocol-schema.md` 中“跨仓 Go 消费者自维护”的旧描述，补 architecture 对外部 native SDK 的边界；此时只描述已完成的合同，不宣称 SDK 已可用。

修改位置：Protocol schema、`src/invoke-input.ts/index.ts/generated/`、`scripts/gen-types.mjs`、Kernel 必要的输入校验/常量引用、`test/kernel-ipc-contract.test.js`、schema/fixture 回归、任务记录和上述规则。若只补 Schema 即可，禁止顺带重构 Kernel 服务生命周期。

退出：A01-A08/A39 的合同部分通过，8 方法覆盖表无洞；TS 现有合法请求样例通过；代码生成输入无宽泛替代本应已知的数据；Windows spike 若未获得机器，保持 M0 平台子项未完成并继续可独立完成的生成工作，不能据此进入最终验收。

## M1：生成器与模板

1. 实现 `native/codegen/normalize.mjs`，从两个 Schema 及行为源读取可达闭包；输出 IR。先检测 unsupported keyword/歧义 union/重复字段、输出路径冲突，再写文件。
2. 实现语言 emitter 与模板，至少先生成 InvokeInput、环境、RunRef、HostFrame/CanonicalEvent、两种交互响应、未知错误、八方法 wrapper 和完整 invoke 状态机；随后覆盖其全部可达依赖。不得将暂未支持的对象改成 map/unknown 通过生成。
3. 按 design 实现 presence、raw JSON、Unicode 和安全整数 codec。schema 形状校验生成；跨字段身份、cursor、状态按共享行为生成；Provider 权限判定仍在 Kernel/Adapter。
4. 新增输出 manifest：记录输入 hash、模板/生成器版本和完整生成文件集合；生成文件有禁止手改标记。`--check` 临时生成比较，不修改工作区。
5. 增加 codegen 回归：相同输入两次一致；新增可选属性/新增方法/修改 result 类型的测试小 Schema 自动影响三语言输出；删除定义删除预期产物；未知关键字失败且零部分写入；禁止在手写 transport 重复 wire method 和状态机。

修改位置：`native/codegen/**`、三语言 `generated*`、Protocol TS 生成脚本、`native/tests/codegen.test.mjs`、根 package.json 的可选 `native:gen/native:check` 命令。根 build/prepare/install 不调用任何 native 工具。

退出：A09-A12/A37 生成相关项通过；从完整当前 Schema 可重复产生三套代码；最低工具链能检查生成语法。不能只交生成模型就称 M1 完成。

## M2：共享真实 IPC 联调器

1. `native/tests/serve-kernel.mjs` 直接复用 `kernelFixture` 所用 createKernelService 和已有 fake Adapter manifest，提供 ready endpoint/instance 及 teardown；测试宿主拥有此临时服务，SDK 不拥有它。Windows 用真实 pipe 名，Unix 用短临时路径。
2. `native/tests/run.mjs` 支持 `--language go|rust|python|ts|all`、`--suite protocol|interop|faults|package|all`、`--endpoint` attach、`--evidence`；没有所需工具链即失败，不自动 skip。默认测试临时 fixture，`--endpoint` 从不启动/关闭所给现有服务。
3. 为三语言实现 driver executable/module：每个 driver 从 stdin 接收仅用于测试的命令，调用安装包公共 API，并向 stdout 输出安全测试证据。driver 不手写 wire RPC。stdout 不打印原始 Provider/输入或凭据，诊断走 stderr。
4. `driver-protocol.md` 定义测试命令、barrier、schema fixture verdict、事件 seq/ref、error、registry snapshot 和退出结果。运行器将权威 fixture 原样送入每语言 codec；同时跑 TS reference，断言结果一致。
5. 复用 `test/kernel-relay.js` 注入 ACK 丢失/断流/控制 ACK 丢失；新增 raw-byte relay 专项发送分块 UTF-8、无换行超限、错误 envelope、截断及错通知。不得用原 relay 的字符串 chunk 累计逻辑代验字节边界。
6. fake Adapter 增加 run identity 关联的 invoke/start/cancel/respond 计数和可控正常/失败/lost/交互/大帧场景。按 barrier 触发故障，不能依赖 sleep 猜测“已经受理”。统计来自上游请求及 Adapter，不只数客户端调用次数。

修改位置：`native/tests/**`、三语言测试 driver、既有 fixture 的最小扩展、Protocol scenarios/fixtures。使用 test-only API，不把测试计数或控制字段加入生产协议。

退出：运行器先对 TS reference 通过 A13-A30 的基础场景；同一 scenario 能发给任意 driver；artifact 中能证明 invoke/start/control 的实际次数。验证器自身不能无条件输出 PASS。

## M3：Go 纵向切片

实现 `native/go/go.mod/go.sum`、生成 wire/client/invoke/registry 和 `transport_unix.go/transport_windows.go`。Go 使用单消费者 Next 拉取，不启动无界读协程；ctx/deadline 驱动独立受限 cancel，Next 继续观察尾流。Close 为观察关闭；client.Close 不停止服务。保留原错误 code、data 与 errors.Is/As 可检查信息。

先跑 status/list → canonical invoke → native invoke → get/subscribe → 两类 respond → explicit cancel，再跑 ACK 丢失、续流与 ctx 竞态。第一轮即使用真实 TS Kernel，不以 fake server 代替。测试 `go test -race ./...`，输出 driver、最小独立二进制和 examples。CGO_ENABLED=0 的独立 Go binary 可连接既有服务，客户端机器不启动 Node。

退出：Go 的 A01-A38 相关项在本机通过，M0 Windows spike 和 Go Windows interop 有证据后方可标记 Go 三平台完成；其他未有平台不阻塞 Rust/Python 开发，但保留待验。发现公共合同问题回 M0/M1 修复，并重跑 TS/Go 已通过的受影响项。

## M4：Rust SDK

实现 `native/rust/Cargo.toml/Cargo.lock`、`src/generated/**` 与平台 transport。使用 Tokio byte stream、serde codec、CancellationToken，生成 lazy Stream 和 registry；不在 Drop 发送业务 cancel。异步清理提供 awaitable close，drop 的连接/任务资源仍可最终释放；未完成执行记录保持 unknown，不能假报 drain complete。

通过 M2 driver 执行同一矩阵。补最低 Rust 版本构建、fmt、clippy、partial write、pipe busy/connect deadline 与 task drop 清理。用 `cargo package` 产物在仓外 build/run，避免靠仓库内路径依赖通过。Rust 包不依赖 Node 生成。

退出：Rust 的 A01-A38 相关项按与 Go 相同证据验收；对生成器的 Rust 修订不能破坏 Go 或 TS。Windows 原生 I/O 未跑保持缺口。

## M5：Python SDK

实现 `native/python/pyproject.toml/uv.lock`、生成 dataclass/codec/client/invoke/registry、Unix asyncio 与 Windows pywin32 transport。Linux/macOS 不导入 pywin32；Windows wheel 由 platform marker 依赖，SDK 不现场编译扩展或下载 Node。支持 Python 3.11+，使用 unittest.IsolatedAsyncioTestCase 覆盖并发和生命周期。

Windows executor 只运行真正受控的 overlapped I/O 等待，取消后 GetOverlappedResult 确认结束再释放额度。event-loop Future cancel 不代替底层取消。显式 cancel token/deadline 控制执行；Task.cancel 只结束观察，并确保已写出 admission 的内部状态最终落入 accepted/unknown。使用 async context manager 显式关闭消费者和 client。

通过 M2 全量 driver 场景。构建 wheel/sdist，清洁 venv 只装 wheel 和声明依赖，移除仓库/Schema/Node 路径后调用已有 Kernel。补 Python bool/int、Decimal、UNSET、null、Windows no leaked handle/thread 和 event-loop shutdown。

退出：Python 的 A01-A38 相关项通过；三语言都能完成同一调用链后进入 M6，不能将任一包降为“以后补”。

## M6：平台、包外与真实 Provider

在 `.github/workflows/ci.yml` 新增 native matrix：OS 为 ubuntu/macos/windows，language 为 go/rust/python，toolchain 为 minimum/current，合计 18 格。current 在实施时固定精确版本并写入 artifact，不能每次跑时隐式漂移。Node 24 只用于 CI 测试服务/生成，现有 TS Node 24/26 矩阵保留。所有 action 使用仓库要求的固定 SHA。

每格独立 build/test/interop/faults/package；必需平台不支持时 fail，不能用 continue-on-error 或 skip 得到绿色。`CI Gate.needs` 加 native matrix 和独立生成检查 job；workflow_dispatch/workflow_call 同样执行，npm release 原有 Gate 保持。运行时间先按分阶段套件控制，不通过放宽协议预算掩盖慢测试。

同步维护 `.github/CI.md`、workflow sanity 的实际断言和 generated drift 文件列表；检查生成 IPC TS 文件与所有 native 输出，不能只沿用旧 protocol-types.ts 单文件检查。根 format/check 的现有 glob 不含 native，新增 native 专用格式入口并由相应语言 job 调用，不能让新目录落在检查范围外。

每语言最低版本/当前版本跑协议与行为；每 OS 至少有一个当前版本环境执行隔离客户端无 Node 的仓外产物。服务在另一个由测试宿主拥有的进程运行；清除客户端 PATH 的 Node 入口并让 spawn Node/CLI 明确失败，随后用独立 binary/wheel 客户端完成 invoke。安装依赖时可以有开发工具，但运行客户端不能触发它们。

Go 包外验证以标准 module zip 为安装输入：测试工具用 `golang.org/x/mod/zip` 生成临时 file GOPROXY 的 `.mod/.info/.zip`，以独立 prerelease 测试版本下载到空 module cache，再在无仓库目录的消费工程 build；不能只靠 replace 指向工作树。该打包 helper 是测试工具，不进入 Go SDK 的运行依赖。Rust 解开 `.crate` 后在独立临时目录编译消费工程，Python 从 wheel/sdist 安装到新 venv；不把测试 driver 与 Schema 当成运行依赖带入包外产物。

真实 Provider 联调使用受保护测试配置和临时 workspace：三语言都验证至少一个声明支持 native 的实际 Adapter（Codex 或 Claude）及同 Adapter 的 canonical 输出，完成文本流、真实终态、审批/追问、显式取消。若没有可触发的真实交互，记录未验，fake 场景仍必跑，不能宣称完整真实交互通过。跨平台 pipe/UDS 的自动化可用 fake Provider，必须明确它验证的是实际 Kernel/worker/OS IPC。

若涉及 IM/外部服务，按 engineering 使用线上测试环境，不访问生产，不发送未授权业务消息；本任务原生 IPC 本身不需要 IM。不得把 IM 登录变为本地执行前提。证据中保存平台/架构/工具链/SDK hash/Kernel commit/ref/seq/计数/错误和结果，不保存输入正文、图片、Provider 原始载荷或凭据。

退出：A31-A38 的九格平台矩阵全部有必测证据，A40 真实 Provider 范围单列。环境缺失可继续其他工作，但整个 issue 不能据此宣布完成。

## M7：回归、文档和交付检查

更新 `native/README.md`、三语言示例、`SDK_NATIVE_INTEGRATION_FULL_GUIDE.md`、`INTEGRATION.md`、中英开发者文档、protocol/local-execution/architecture 规则及本任务证据。示例展示首次消费、收尾、取消、交互、原 ref lookup/subscribe、unknown 处理；说明服务预先存在、Node 只在服务端。正常消费者的最短路径不要求手动操作 registry。

发布规则写明 Go subdirectory tags、Rust crate、Python wheel/sdist、独立 SemVer、服务兼容范围、生成再现流程。只打包检查，不发布 registry。沿现有 npm 打包/离线验证确认 native 不是 Runtime 安装前提。

A01-A40 每项填写证据/失败/未验，执行 TS 全量回归、三语言单测、生成漂移、包外验证、OKF 和 diff 检查。将真实结果写 journal。若用户之后授权 commit，保留 Git identity，英文 message 并加一次 `Co-authored-by: Codex <noreply@openai.com>`；PR/issue 使用英文，Squash 保留 trailer。

## 命令与预期结果

以下前两组使用现有工具，原生相关路径和命令为 M1-M5 必须实现的目标，当前不能直接运行。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm build
node --test test/kernel-ipc-contract.test.js test/kernel-clients.test.js test/kernel-invoke.test.js test/kernel-invoke-lifecycle.test.js test/host-run-service.test.js
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm format:check
pnpm docs:check
pnpm test
```

```sh
# 未来生成与共享回归，从仓库根执行。
node native/codegen/generate.mjs
node native/codegen/generate.mjs --check
node --test native/tests/codegen.test.mjs native/tests/interop.test.mjs
node native/tests/run.mjs --language all --suite all --evidence .tmp/native-evidence
# 已有 endpoint 模式：运行器和三个 SDK 都不能启动/关闭该服务。
node native/tests/run.mjs --language all --suite interop --endpoint "$OCTO_NATIVE_TEST_ENDPOINT" --evidence .tmp/native-attach
```

```sh
# 分别以 native/go、native/rust、native/python 为当前目录运行。
go test -race ./...
go vet ./...
go build ./...
cargo test --locked
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo package --locked
uv sync --locked --python 3.11
uv run python -m unittest discover -s tests
uv build
```

任一命令非零阻塞相应阶段；Windows Go race 另检查工具链依赖，race 工具不可用时普通单测/互操作仍必需，race 格明确未验。`--suite all` 必须清洁回收本次临时服务/relay/driver，用户提供的 endpoint 不回收。中止/超时后的 evidence 必须记录 unknown 和 cleanup incomplete，不能由脚本退出码覆盖。

## 回退方式

增量 Schema 保持原请求兼容；TS 改动限于权威定义派生和必要校验。实施回退可移除 native 可选命令/jobs 与新增包，不改变 Home/配置/会话数据。禁止通过删除用户状态或重启真实共享 Kernel“修复”不通过的测试。已产生的业务副作用不由 SDK 自动补偿。
