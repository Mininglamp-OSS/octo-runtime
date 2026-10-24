package octo

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"
)

func TestInvocationInitializationFailureIsStable(t *testing.T) {
	for _, scenario := range []string{"cancelled", "invalid-input", "admission-closed"} {
		t.Run(scenario, func(t *testing.T) {
			client := Attach("unused")
			defer client.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			input, err := Decode[InvokeInputWire]("InvokeInputWire", []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}]}`))
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "cancelled":
				cancel()
			case "invalid-input":
				input.SessionGeneration = Some(int64(-1))
			case "admission-closed":
				client.StopAdmission()
			}
			stream := client.Invoke(ctx, input, KernelInvokeEnvironmentWire{})
			_, first := stream.Next()
			if first == nil {
				t.Fatal("expected initialization failure")
			}
			if scenario == "cancelled" && !errors.Is(first, context.Canceled) {
				t.Fatal(first)
			}
			for n := 0; n < 2; n++ {
				if _, err := stream.Next(); !errors.Is(err, io.EOF) {
					t.Fatalf("Next after error: %v", err)
				}
			}
			if len(client.Invocations()) != 0 {
				t.Fatal("failed initialization retained registry")
			}
			if len(client.transport.sockets) != 0 || client.transport.opening != 0 {
				t.Fatal("preflight failure opened transport")
			}
		})
	}
}

type observedContext struct {
	context.Context
	once    sync.Once
	checked chan struct{}
}

func (c *observedContext) Err() error {
	c.once.Do(func() { close(c.checked) })
	return c.Context.Err()
}

func TestCloseObservationUnblocksPendingCancelAcknowledgement(t *testing.T) {
	for _, callerCancelled := range []bool{false, true} {
		t.Run(map[bool]string{false: "explicit-cancel", true: "caller-cancel"}[callerCancelled], func(t *testing.T) {
			client := Attach("unused")
			defer client.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if callerCancelled {
				cancel()
			}
			observed := &observedContext{Context: ctx, checked: make(chan struct{})}
			stream := client.Invoke(observed, InvokeInputWire{}, KernelInvokeEnvironmentWire{})
			// The terminal frame was delivered, but the separate control request still awaits its ACK.
			r := &record{cancelDone: make(chan struct{})}
			stream.started, stream.record = true, r
			stream.subscription = client.Subscribe(stream.observation, KernelRunRef{}, 0)
			stream.subscription.done = true
			stream.cancelOnce.Do(func() {})
			t.Cleanup(func() { close(stream.cancelFinished); close(r.cancelDone) })
			result := make(chan error, 1)
			go func() { _, err := stream.Next(); result <- err }()
			select {
			case <-observed.checked:
			case <-time.After(time.Second):
				t.Fatal("Next did not reach cancellation wait")
			}
			stream.Close()
			select {
			case err := <-result:
				if !errors.Is(err, io.EOF) {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("Close did not unblock Next")
			}
			select {
			case <-r.cancelDone:
				t.Fatal("observation close completed control request")
			default:
			}
		})
	}
}

func TestCancelControlErrorSurvivesNormalExhaustion(t *testing.T) {
	client := Attach("unused")
	defer client.Close()
	stream := client.Invoke(context.Background(), InvokeInputWire{}, KernelInvokeEnvironmentWire{})
	want := &Error{Code: "OPERATION_OUTCOME_UNKNOWN"}
	r := &record{cancelDone: make(chan struct{}), cancelErr: want}
	close(r.cancelDone)
	stream.started, stream.record = true, r
	stream.subscription = client.Subscribe(stream.observation, KernelRunRef{}, 0)
	stream.subscription.done = true
	_, err := stream.Next()
	if !errors.Is(err, want) {
		t.Fatalf("lost control error: %v", err)
	}
}
