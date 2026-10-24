package octo

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

// 传输只负责有界字节 IO；method、身份和重试均由生成客户端控制。
type transport struct {
	endpoint string
	mu       sync.Mutex
	closed   bool
	sockets  map[net.Conn]bool
	opening  int
}
type channel struct {
	net.Conn
	reader *bufio.Reader
	owner  *transport
	once   sync.Once
}

func (t *transport) open(ctx context.Context) (*channel, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil, &Error{Code: "CLIENT_CLOSED"}
	}
	if len(t.sockets)+t.opening >= limitConnections {
		t.mu.Unlock()
		return nil, &Error{Code: "CLIENT_CAPACITY_EXHAUSTED"}
	}
	t.opening++
	t.mu.Unlock()
	conn, e := dial(ctx, t.endpoint)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.opening--
	if e != nil {
		return nil, &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	if t.closed {
		conn.Close()
		return nil, &Error{Code: "CLIENT_CLOSED"}
	}
	t.sockets[conn] = true
	return &channel{Conn: conn, reader: bufio.NewReaderSize(conn, limitReadChunkBytes), owner: t}, nil
}
func (t *transport) close() {
	t.mu.Lock()
	t.closed = true
	for conn := range t.sockets {
		conn.Close()
	}
	t.mu.Unlock()
}
func (c *channel) Close() error {
	var e error
	c.once.Do(func() { e = c.Conn.Close(); c.owner.mu.Lock(); delete(c.owner.sockets, c.Conn); c.owner.mu.Unlock() })
	return e
}
func (c *channel) line() ([]byte, error) {
	var out []byte
	for {
		part, e := c.reader.ReadSlice('\n')
		if len(out)+len(part) > limitLineBytes+1 {
			return nil, &Error{Code: "HOST_FRAME_TOO_LARGE"}
		}
		out = append(out, part...)
		if e == nil {
			return bytes.TrimSuffix(out, []byte{'\n'}), nil
		}
		if e != bufio.ErrBufferFull {
			if ne, ok := e.(net.Error); ok && ne.Timeout() {
				return nil, &Error{Code: "KERNEL_TIMEOUT", Cause: e}
			}
			return nil, &Error{Code: "CONNECTION_CLOSED", Cause: e}
		}
	}
}
func (c *channel) write(b []byte) error {
	for len(b) > 0 {
		n, e := c.Write(b)
		b = b[n:]
		if e != nil {
			return &Error{Code: "CONNECTION_CLOSED", Cause: e}
		}
		if n == 0 {
			return &Error{Code: "CONNECTION_CLOSED", Cause: io.ErrShortWrite}
		}
	}
	return nil
}
func deadline(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, d)
}
func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func cancelled(e error) bool {
	return errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded)
}
