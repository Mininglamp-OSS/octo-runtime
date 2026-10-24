package pipe

import (
	"context"
	"net"

	"github.com/Microsoft/go-winio"
)

// DialContext 仅封装 Windows 原生连接；连接额度、超时和关闭所有权由外层 transport 管理。
func DialContext(ctx context.Context, endpoint string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, endpoint)
}
