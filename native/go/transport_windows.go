//go:build windows

package octo

import (
	"context"
	"github.com/Microsoft/go-winio"
	"net"
)

func dial(ctx context.Context, endpoint string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, endpoint)
}
