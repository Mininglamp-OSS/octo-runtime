# Rust 原生 Client

最低 Rust 1.85，Tokio 异步 API。crate 名为 `octo-runtime-client`，当前源码版本 `0.0.0` 未发布。

```sh
cargo build --locked --example playboard-demo
cargo test --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo run --locked --example playboard-demo -- status --endpoint /path/kernel.sock
```

[playboard-demo.rs](examples/playboard-demo.rs) 包含 `Client::attach`、typed 输入、lazy `invoke` Stream、原回执查询、`CancelToken`、交互和绝对截止时间 `drain`。已知模型从 Schema 生成；开放对象扩展保留为 serde_json Value，启用 arbitrary_precision。`decode`/`encode` 执行协议校验；仅 serde 绑定不能代替校验。

统一命令和验证入口见 [native README](../README.md) 与 [demo 说明](../examples/README.md)。`drop` Stream 只关闭观察；执行取消必须显式请求，最终调用 `close().await` 释放客户端 IO。
