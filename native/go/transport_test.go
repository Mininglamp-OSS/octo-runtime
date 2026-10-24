package octo

import (
	"bufio"
	"bytes"
	"errors"
	"net"
	"testing"
	"time"
)

func TestOversizedLineDoesNotWaitForNewlineOrEOF(t *testing.T) {
	reader, writer := net.Pipe()
	defer reader.Close()
	defer writer.Close()
	c := &channel{Conn: reader, reader: bufio.NewReaderSize(reader, limitReadChunkBytes)}
	done := make(chan error, 1)
	go func() { _, err := c.line(); done <- err }()
	// 保持 peer 打开；恰好多一个字节也必须主动拒绝，不能等下一块或 EOF。
	if _, err := writer.Write(bytes.Repeat([]byte{'x'}, limitLineBytes+1)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var typed *Error
		if !errors.As(err, &typed) || typed.Code != "HOST_FRAME_TOO_LARGE" {
			t.Fatalf("got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("oversized unterminated line blocked")
	}
}

func TestLineBoundaryAndBufferedTail(t *testing.T) {
	for _, size := range []int{limitLineBytes - 1, limitLineBytes, limitLineBytes + 1} {
		data := append(bytes.Repeat([]byte{'x'}, size), []byte("\nnext\r\n")...)
		c := &channel{reader: bufio.NewReaderSize(bytes.NewReader(data), limitReadChunkBytes)}
		line, err := c.line()
		if size > limitLineBytes {
			var typed *Error
			if !errors.As(err, &typed) || typed.Code != "HOST_FRAME_TOO_LARGE" {
				t.Fatalf("size %d: %v", size, err)
			}
			continue
		}
		if err != nil || len(line) != size {
			t.Fatalf("size %d: got %d, %v", size, len(line), err)
		}
		line, err = c.line()
		if err != nil || string(line) != "next\r" {
			t.Fatalf("lost buffered tail: %q, %v", line, err)
		}
	}
}
