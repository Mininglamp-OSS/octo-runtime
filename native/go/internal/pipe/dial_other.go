//go:build !windows

package pipe

import (
	"context"
	"errors"
	"net"
)

// 非 Windows 仍可编译统一 transport；正常连接由外层选择 Unix socket，此入口不可用。
func DialContext(context.Context, string) (net.Conn, error) {
	return nil, errors.New("Windows named pipes are unavailable on this platform")
}
