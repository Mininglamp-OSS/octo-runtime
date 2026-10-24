# Go 原生 Client

最低 Go 1.25。公开包为 `github.com/Mininglamp-OSS/octo-runtime/native/go`，当前源码版本未发布。

```sh
go test -race ./...
go build -o ../../.tmp/playboard-demo-go ./examples/playboard-demo
```

[playboard-demo/main.go](examples/playboard-demo/main.go) 包含 `Attach`、输入解码、lazy `Invoke`、`Invocations`、原回执查询、交互、context 取消和 owner drain 的完整接入示例。`Decode[T]`/`Encode` 执行协议校验；仅 `json.Unmarshal` 不能替代 wire 校验。开放对象额外字段保存在 `Extra`，原生 JSON 使用 `json.RawMessage`。

统一命令和验证入口见 [native README](../README.md) 与 [demo 说明](../examples/README.md)。Windows 使用 go-winio 原生 named pipe，Unix 使用 net.Conn。
