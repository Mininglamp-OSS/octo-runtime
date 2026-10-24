# Go 原生 Client

最低 Go 1.25。公开包为 `github.com/Mininglamp-OSS/octo-runtime/native/go`，当前源码版本未发布。

```sh
go test -race ./...
go build -o ../../.tmp/playboard-demo-go ./examples/demo_playboard.go
```

[demo_playboard.go](examples/demo_playboard.go) 包含 `Attach`、输入解码、lazy `Invoke`、`Invocations`、原回执查询、交互、context 取消和 owner drain 的完整接入示例。`Decode[T]`/`Encode` 执行协议校验；仅 `json.Unmarshal` 不能替代 wire 校验。开放对象额外字段保存在 `Extra`，原生 JSON 使用 `json.RawMessage`。

统一命令和验证入口见 [native README](../README.md) 与 [demo 说明](../examples/README.md)。只需导入上述一个 SDK 包；`transport.go` 内部自动选择 Windows named pipe 或 Unix socket。`internal/pipe` 仅隔离 go-winio 的 Windows 专用 API，由 Go 自动编译目标平台文件；不需要手工复制、选择文件或修改 import。
