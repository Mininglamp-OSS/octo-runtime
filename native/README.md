# 原生 RPC Client 与 playboard demo

Go、Rust、Python 各自实现原生 SDK 和 CLI demo，直接连接已有 Executor Kernel 的 Unix socket / Windows named pipe。客户端运行时不调用 Node、不启动 CLI 子进程、不读取 Schema。Kernel 和 Provider 由宿主管理。

| 语言   | SDK               | playboard demo                                                  | 工具链最低版本 |
| ------ | ----------------- | --------------------------------------------------------------- | -------------- |
| Go     | [go](go/)         | [examples/playboard-demo](go/examples/playboard-demo/)          | Go 1.25        |
| Rust   | [rust](rust/)     | [examples/playboard-demo.rs](rust/examples/playboard-demo.rs)   | Rust 1.85      |
| Python | [python](python/) | [examples/playboard_demo.py](python/examples/playboard_demo.py) | Python 3.11    |

三套 demo 的命令和输出相同。完整命令见 [playboard 使用说明](examples/README.md)。代码位于本仓库 `native/`，没有外部 demo 仓库依赖。

## 构建和运行

从仓库根目录执行；先由宿主安装并启动 Kernel，取得实际 endpoint。macOS/Linux 默认 Runtime Home 的地址通常是 `$HOME/.octo-runtime/sockets/octo-runtime-executor-kernel.sock`，自定义 Home 请使用对应地址。Windows 使用宿主提供的完整 pipe 名，不拼接猜测 hash。

```sh
mkdir -p .tmp
(cd native/go && go build -o ../../.tmp/playboard-demo-go ./examples/playboard-demo)
cargo build --locked --manifest-path native/rust/Cargo.toml --example playboard-demo
uv sync --project native/python --frozen --python 3.11

export OCTO_KERNEL_ENDPOINT="$HOME/.octo-runtime/sockets/octo-runtime-executor-kernel.sock"
.tmp/playboard-demo-go playboard --request native/examples/request.json --receipt .tmp/go-run.json
native/rust/target/debug/examples/playboard-demo playboard --request native/examples/request.json --receipt .tmp/rust-run.json
native/python/.venv/bin/python -I native/python/examples/playboard_demo.py playboard --request native/examples/request.json --receipt .tmp/python-run.json
```

Windows 的 Python 路径是 `native/python/.venv/Scripts/python.exe`，Go/Rust 可执行文件带 `.exe`。Python 仅在 Windows 安装锁定的 `pywin32` wheel。

## SDK 使用边界

- `Attach` / `Client::attach` / `Client` 只附着服务。`Invoke` / `invoke` 在开始迭代时提交；先 `Status`/`List` 检查服务和 Adapter，再消费流到终态。
- 默认 `native` 返回完整 HostFrame；显式 `canonical` 返回 CanonicalEvent。订阅游标、Kernel instance 和原调用身份不能被新运行替换。
- `Submit` / `submit` 返回接纳回执。需要高级控制时，保留原 `RunRef`，调用 `get`、`subscribe`、`cancel`、`respond`、`respond_native`。接纳 ACK、取消 ACK 与执行终态是不同事实。
- Go 的 `context`、Rust/Python 的显式 `CancelToken` 请求执行取消并继续读尾流。关闭迭代器、drop 或 Python `Task.cancel()` 只停止观察；宿主仍需处置登记中的未完成执行。
- SDK `Close` / `close` 不停止 Kernel、不批量取消 Run。owner 退出时先 `stop_admission`，再带绝对截止时间 `drain`；`unresolved` 非空不能按成功处理。
- 未知业务错误 code 保留；ACK 不确定时只按原身份查询，不能自动重提 invoke/respond/cancel。`RUN_OUTCOME_UNKNOWN` 保留在 registry，供宿主决策。
- Go 使用 `Optional[T]`/`Some` 区分缺省；Rust 使用 `Presence<T>`；Python 使用 TypedDict 缺键/`UNSET`。显式 `null` 仅用于允许空值的字段。开放对象扩展和原生载荷保留 JSON；本地数值保真不改变 TS 服务端 `JSON.parse` 的数值边界。

## 协议生成

数据唯一来源是 `packages/octo-runtime-protocol/schema/` 下的 `protocol.schema.json`、`kernel-ipc.schema.json` 和 `kernel-client.behavior.json`。`native/codegen` 只生成协议类型、校验规则、行为常量和 RPC 接口。客户端流程、生命周期和 transport 在各语言包内各维护一份手写源码，不再复制为模板和生成文件。

```sh
node native/codegen/generate.mjs
node native/codegen/generate.mjs --check
node --test native/tests/codegen.test.mjs
```

重新生成需要 Node、gofmt、rustfmt；`--check` 只需要 Node，核对 Schema、生成器、产物清单及每个文件的 SHA-256 摘要，修改、缺失或遗留产物都会报错。它不重新运行语言 formatter；完整重新生成的字节一致性由 `codegen.test.mjs` 验证。安装/运行已生成 SDK 不需要生成工具。

修改 Schema 或 emitter 后重新生成，禁止只改生成文件。未知关键字在写文件前失败。模型保留公共根及其类型依赖；三语言校验规则共用去重后的节点图，Rust union 共用一份 Schema 分支绑定逻辑。

## 验证

Native 是可选功能，不接入 GitHub Actions 或 CI Gate。以下检查按需在本地运行；未执行的平台不能记为通过。

先 `pnpm install --frozen-lockfile` / `pnpm build` 构建测试 Kernel，安装各语言工具链，执行上述 Python `uv sync`。

```sh
(cd native/go && go test -race ./...)
cargo test --locked --manifest-path native/rust/Cargo.toml --all-targets
uv run --project native/python --frozen python -m unittest discover -s native/python/tests -p 'test_*.py'
node native/tests/run.mjs --language all --evidence .tmp/native-evidence.json
# 单语言或单套件
node native/tests/run.mjs --language all --suite lifecycle
node native/tests/run.mjs --language rust --suite playboard-demo
node native/tests/run.mjs --language python --suite package
# 显式真实 Provider 联调；使用已有 Kernel，不由脚本启动/停止它
node native/tests/live-demo.mjs --endpoint "$OCTO_KERNEL_ENDPOINT" --language all
```

自动化使用真实 Kernel、隔离 worker 和 fake Provider，验证三套客户端；CLI 子进程清空 `PATH`。真实 Provider smoke 单独执行，会实际调用所选模型，保存终态/计数/回执证据，不保存 Provider 原始内容。

当前 macOS arm64 三语言最低/当前工具链已各通过 39 项协议、故障、demo 和包外消费测试，并各自完成真实 Codex 的 native/canonical 调用。Windows/Linux 和完整容量/竞态仍待验证，逐项证据见 [实施记录](../.octospec/tasks/51-native-rpc-clients/implementation.md)；此处不表示九格平台验收已完成。

本轮六项审查修复及新增回归见[修复记录](../.octospec/tasks/51-native-rpc-clients/review-fixes.md)。Windows 关闭取消测试在非 Windows 主机使用 API stub，只证明控制流与最终释放顺序。
