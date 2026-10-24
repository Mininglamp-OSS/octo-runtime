package octo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"reflect"
	"sync"
	"sync/atomic"
	"time"
)

// Client 附着到已有 Kernel；Close 只释放本 client 的观察与控制 IO。
type Client struct {
	transport   *transport
	mu          sync.Mutex
	stopped     bool
	records     map[string]*record
	controls    chan struct{}
	drainDone   chan struct{}
	drainResult DrainResult
}

func Attach(endpoint string) *Client {
	return &Client{transport: &transport{endpoint: endpoint, sockets: make(map[net.Conn]bool)}, records: make(map[string]*record), controls: make(chan struct{}, limitControlConcurrency)}
}
func (c *Client) Close() { c.StopAdmission(); c.transport.close() }
func uuid() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func raw(value any) json.RawMessage { b, _ := marshalJSON(value); return b }
func object(value any) map[string]any {
	b := raw(value)
	v, _ := decodeJSON(b)
	m, _ := v.(map[string]any)
	return m
}
func numeric(v any) int64 {
	if n, ok := v.(json.Number); ok {
		x, _ := integerNumber(n)
		return x
	}
	return -1
}
func same(a, b map[string]any, fields []string) bool {
	for _, f := range fields {
		if !jsonEqual(a[f], b[f]) {
			return false
		}
	}
	return true
}
func fullIdentity(actual, expected map[string]any) error {
	if actual["kernel_instance_id"] != expected["kernel_instance_id"] {
		return &Error{Code: "KERNEL_INSTANCE_CHANGED"}
	}
	if !same(actual, expected, receiptFields) {
		return &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	return nil
}
func (c *Client) rpc(ctx context.Context, method string, params, result any, beforeWrite func() error) error {
	m, ok := methodRules[method]
	if !ok {
		return &Error{Code: "METHOD_NOT_FOUND"}
	}
	if e := checkStrings(reflect.ValueOf(params), 0); e != nil {
		return e
	}
	pv := object(params)
	if e := validate(m.Params, pv, "$.params"); e != nil {
		return e
	}
	id := uuid()
	line := append(raw(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": pv}), '\n')
	if len(line) > limitRequestBytes {
		return &Error{Code: "INVOKE_REQUEST_TOO_LARGE"}
	}
	timeout := time.Duration(timeoutUnary) * time.Millisecond
	if method == "agent_run.invoke" {
		timeout = time.Duration(timeoutInvokeAck) * time.Millisecond
	}
	call, cancel := deadline(ctx, timeout)
	defer cancel()
	connect, release := deadline(call, time.Duration(timeoutConnect)*time.Millisecond)
	conn, e := c.transport.open(connect)
	release()
	if e != nil {
		return e
	}
	defer conn.Close()
	stop := context.AfterFunc(call, func() { conn.Close() })
	defer stop()
	until, _ := call.Deadline()
	conn.SetDeadline(until)
	if e = call.Err(); e != nil {
		return e
	}
	if beforeWrite != nil {
		if e = beforeWrite(); e != nil {
			return e
		}
	}
	sent := true // 部分写入也可能被接纳；此后不能重发 side effect。
	if e = conn.write(line); e == nil {
		var b []byte
		b, e = conn.line()
		if e == nil {
			var v any
			v, e = decodeJSON(b)
			if e == nil {
				var answer any
				answer, e = response(v, id)
				if e == nil {
					e = validate(m.Result, answer, "$.result")
					if e != nil {
						e = &Error{Code: "INVALID_RESPONSE", Cause: e}
					}
					if e == nil {
						e = unmarshalWire(raw(answer), result)
					}
				}
			}
		}
	}
	if e != nil && m.SideEffect && method != "agent_run.invoke" && sent {
		if remote, ok := e.(*Error); !ok || !remote.Remote {
			return &Error{Code: "OPERATION_OUTCOME_UNKNOWN", Cause: e}
		}
	}
	return e
}
func response(v any, id string) (any, error) {
	m, ok := v.(map[string]any)
	if !ok || m["id"] != id || m["jsonrpc"] != "2.0" {
		return nil, &Error{Code: "INVALID_RESPONSE"}
	}
	_, hasResult := m["result"]
	_, hasError := m["error"]
	if hasResult == hasError {
		return nil, &Error{Code: "INVALID_RESPONSE"}
	}
	name := "IpcSuccessResponse"
	if hasError {
		name = "IpcErrorResponse"
	}
	if e := validate(definitionRules[name], m, "$"); e != nil {
		return nil, &Error{Code: "INVALID_RESPONSE", Cause: e}
	}
	if hasError {
		err := m["error"].(map[string]any)
		data := err["data"].(map[string]any)
		return nil, &Error{Code: data["code"].(string), Data: data, Remote: true}
	}
	return m["result"], nil
}
func (c *Client) Status(ctx context.Context) (KernelStatus, error) {
	return c.RPCStatus(ctx, IpcEmptyParams{})
}
func (c *Client) List(ctx context.Context) ([]HostedAdapterMetadataWire, error) {
	return c.RPCList(ctx, IpcEmptyParams{})
}
func keyFor(input map[string]any) KernelLookupKey {
	m := map[string]any{}
	for wire, field := range identityInputFields {
		m[wire] = input[field]
	}
	var k KernelLookupKey
	unmarshalWire(raw(m), &k)
	return k
}
func identify(input InvokeInputWire) (InvokeInputWire, error) {
	b, e := Encode("InvokeInputWire", input)
	if e != nil {
		return input, e
	}
	mAny, e := decodeJSON(b)
	if e != nil {
		return input, e
	}
	m := mAny.(map[string]any)
	for _, k := range []string{"runId", "invocationId", "sessionId"} {
		if _, ok := m[k]; !ok {
			m[k] = uuid()
		}
	}
	if _, ok := m["protocol_mode"]; !ok {
		m["protocol_mode"] = "native"
	}
	if _, ok := m["sessionGeneration"]; !ok {
		m["sessionGeneration"] = 0
	}
	return Decode[InvokeInputWire]("InvokeInputWire", raw(m))
}

// Submit 接纳后由服务持续执行。ctx 在写前阻止提交，写后等待确定回执并按原 ref 取消。
func (c *Client) Submit(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire) (KernelRunRef, error) {
	return c.submit(ctx, input, env, nil)
}
func (c *Client) submit(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire, r *record) (KernelRunRef, error) {
	var zero KernelRunRef
	if e := ctx.Err(); e != nil {
		return zero, e
	}
	request, e := identify(input)
	if e != nil {
		return zero, e
	}
	key := keyFor(object(request))
	status, e := c.Status(ctx)
	if e != nil {
		return zero, e
	}
	if e = ctx.Err(); e != nil {
		return zero, e
	}
	if r != nil {
		c.mu.Lock()
		r.instance = status.KernelInstanceId
		c.mu.Unlock()
	}
	params := IpcInvokeParams{Input: request, ExecutionEnvOverrides: env.ExecutionEnvOverrides, KernelInstanceId: Some(status.KernelInstanceId)}
	sent := false
	var ack IpcInvokeResult
	e = c.rpc(context.Background(), "agent_run.invoke", params, &ack, func() error {
		if e := ctx.Err(); e != nil {
			return e
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		if r != nil && c.stopped {
			return &Error{Code: "CLIENT_INVOCATION_ADMISSION_CLOSED"}
		}
		sent = true
		if r != nil {
			r.submitted = true
		}
		return nil
	})
	if e == nil {
		ref := object(ack.Receipt)
		ref["kernel_instance_id"] = ack.KernelInstanceId
		var result KernelRunRef
		unmarshalWire(raw(ref), &result)
		if ack.KernelInstanceId != status.KernelInstanceId {
			return zero, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
		}
		if !same(ref, object(key), lookupFields) {
			return zero, &Error{Code: "RUN_IDENTITY_MISMATCH"}
		}
		if r == nil && ctx.Err() != nil {
			_, e = c.Cancel(context.Background(), result, "caller_aborted")
		}
		return result, e
	}
	if !sent {
		return zero, e
	}
	if err, ok := e.(*Error); ok && err.Remote {
		return zero, e
	}
	// 原 invoke 只写一次；查询预算从首次不确定开始，重连成功也不重置。
	recovery, cancel := deadline(context.Background(), time.Duration(timeoutRecovery)*time.Millisecond)
	defer cancel()
	for _, delay := range repairDelaysMs {
		if wait(recovery, time.Duration(delay)*time.Millisecond) != nil {
			break
		}
		snapshot, queryErr := c.Get(recovery, key, status.KernelInstanceId)
		if queryErr == nil {
			if r == nil && ctx.Err() != nil {
				_, queryErr = c.Cancel(context.Background(), snapshot.Ref, "caller_aborted")
			}
			return snapshot.Ref, queryErr
		}
		if code(queryErr) == "RUN_IDENTITY_MISMATCH" || code(queryErr) == "KERNEL_INSTANCE_CHANGED" {
			return zero, queryErr
		}
	}
	return zero, &Error{Code: "ACCEPTANCE_UNKNOWN", Cause: e}
}
func (c *Client) Get(ctx context.Context, key KernelLookupKey, instance string) (KernelRunSnapshot, error) {
	p := IpcGetParams{Key: key}
	if instance != "" {
		p.KernelInstanceId = Some(instance)
	}
	s, e := c.RPCGet(ctx, p)
	if e != nil {
		return s, e
	}
	m := object(s.Ref)
	if instance != "" && s.Ref.KernelInstanceId != instance {
		return s, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
	}
	if !same(m, object(key), lookupFields) {
		return s, &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	if s.Terminal.Set {
		if e = frameIdentity(s.Terminal.Value, s.Ref); e != nil {
			return s, e
		}
		if terminal(s.Terminal.Value) == "" {
			return s, &Error{Code: "HOST_FRAME_INVALID"}
		}
	}
	c.reconcile(s)
	return s, nil
}
func (c *Client) Cancel(ctx context.Context, ref KernelRunRef, reason string) (IpcCancelResult, error) {
	p := IpcCancelParams{Ref: ref}
	if reason != "" {
		p.Reason = Some(reason)
	}
	return c.RPCCancel(ctx, p)
}
func (c *Client) Respond(ctx context.Context, ref KernelRunRef, response InteractionResponseWire) error {
	_, e := c.RPCRespond(ctx, IpcRespondParams{Ref: ref, Response: response})
	return e
}
func (c *Client) RespondNative(ctx context.Context, ref KernelRunRef, response NativeInteractionResponse) error {
	_, e := c.RPCRespondNative(ctx, IpcRespondNativeParams{Ref: ref, Response: response})
	return e
}
func frameIdentity(frame HostFrame, ref KernelRunRef) error {
	m := object(frame)
	if !same(m, object(ref), receiptFields) {
		return &Error{Code: "RUN_IDENTITY_MISMATCH"}
	}
	return nil
}
func terminal(frame HostFrame) string {
	m := object(frame)
	control, _ := m["control"].(map[string]any)
	if m["kind"] == "control" && control["type"] == "state" {
		for _, s := range terminalStates {
			if control["state"] == s {
				return s
			}
		}
	}
	return ""
}

// Subscription 是单消费者拉取流，不在后台预读事件。Close 仅停止观察。
type Subscription struct {
	client      *Client
	ctx         context.Context
	stop        context.CancelFunc
	ref         KernelRunRef
	after       int64
	conn        *channel
	repair      int
	repairUntil time.Time
	done        bool
	mu          sync.Mutex
}

func (c *Client) Subscribe(ctx context.Context, ref KernelRunRef, after int64) *Subscription {
	observe, stop := context.WithCancel(ctx)
	return &Subscription{client: c, ctx: observe, stop: stop, ref: ref, after: after}
}
func (s *Subscription) Close() error {
	s.stop()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn != nil {
		return s.conn.Close()
	}
	return nil
}
func (s *Subscription) setConn(conn *channel) { s.mu.Lock(); s.conn = conn; s.mu.Unlock() }
func (s *Subscription) Next() (HostFrame, error) {
	if s.done {
		return nil, io.EOF
	}
	for {
		if e := s.ctx.Err(); e != nil {
			return nil, e
		}
		if s.conn == nil {
			if e := s.connect(); e != nil {
				if e = s.repairAfter(e); e != nil {
					return nil, e
				}
				continue
			}
			if s.done {
				return nil, io.EOF
			}
		}
		b, e := s.conn.line()
		if e != nil {
			if e = s.repairAfter(e); e != nil {
				return nil, e
			}
			continue
		}
		value, e := decodeJSON(b)
		if e != nil {
			return nil, e
		}
		n, ok := value.(map[string]any)
		if !ok {
			return nil, &Error{Code: "INVALID_RESPONSE"}
		}
		if n["method"] == "agent_run.stream_error" {
			if e = validate(definitionRules["IpcStreamErrorNotification"], n, "$"); e != nil {
				return nil, &Error{Code: "INVALID_RESPONSE", Cause: e}
			}
			p := n["params"].(map[string]any)
			if p["kernel_instance_id"] != s.ref.KernelInstanceId {
				return nil, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
			}
			return nil, &Error{Code: p["code"].(string)}
		}
		if e = validate(definitionRules["IpcEventNotification"], n, "$"); e != nil {
			return nil, &Error{Code: "HOST_FRAME_INVALID", Cause: e}
		}
		p := n["params"].(map[string]any)
		if p["kernel_instance_id"] != s.ref.KernelInstanceId {
			return nil, &Error{Code: "KERNEL_INSTANCE_CHANGED"}
		}
		if p["run_id"] != s.ref.RunId || p["stream_id"] != s.ref.StreamId {
			return nil, &Error{Code: "RUN_IDENTITY_MISMATCH"}
		}
		frame := raw(p["event"])
		if e = frameIdentity(frame, s.ref); e != nil {
			return nil, e
		}
		seq := numeric(object(frame)["seq"])
		if seq != s.after+1 || numeric(p["seq"]) != seq {
			return nil, &Error{Code: "STREAM_GAP"}
		}
		s.after = seq
		s.client.observe(s.ref, frame)
		if terminal(frame) != "" {
			s.done = true
			s.Close()
		}
		return frame, nil
	}
}
func (s *Subscription) connect() error {
	timeout := time.Duration(timeoutUnary) * time.Millisecond
	if !s.repairUntil.IsZero() {
		remaining := time.Until(s.repairUntil)
		if remaining <= 0 {
			return &Error{Code: "KERNEL_UNAVAILABLE"}
		}
		if remaining < timeout {
			timeout = remaining
		}
	}
	ctx, cancel := deadline(s.ctx, timeout)
	defer cancel()
	conn, e := s.client.transport.open(ctx)
	if e != nil {
		return e
	}
	s.setConn(conn)
	context.AfterFunc(s.ctx, func() { conn.Close() })
	until, _ := ctx.Deadline()
	conn.SetDeadline(until)
	p := IpcSubscribeParams{Ref: s.ref, AfterSeq: s.after}
	pv := object(p)
	if e = validate(methodRules["agent_run.subscribe"].Params, pv, "$.params"); e != nil {
		return e
	}
	id := uuid()
	line := append(raw(map[string]any{"jsonrpc": "2.0", "id": id, "method": "agent_run.subscribe", "params": pv}), '\n')
	if e = conn.write(line); e != nil {
		return e
	}
	b, e := conn.line()
	if e != nil {
		return e
	}
	v, e := decodeJSON(b)
	if e != nil {
		return e
	}
	answer, e := response(v, id)
	if e != nil {
		return e
	}
	snapshot, e := Decode[KernelRunSnapshot]("KernelRunSnapshot", raw(answer))
	if e != nil {
		return &Error{Code: "INVALID_RESPONSE", Cause: e}
	}
	if e = fullIdentity(object(snapshot.Ref), object(s.ref)); e != nil {
		return e
	}
	if snapshot.Terminal.Set {
		if e = frameIdentity(snapshot.Terminal.Value, s.ref); e != nil {
			return e
		}
		if terminal(snapshot.Terminal.Value) == "" {
			return &Error{Code: "HOST_FRAME_INVALID"}
		}
		s.client.reconcile(snapshot)
		if s.after >= snapshot.LatestSeq {
			s.done = true
			s.Close()
		}
	}
	conn.SetDeadline(time.Time{})
	return nil
}
func (s *Subscription) repairAfter(e error) error {
	if s.conn != nil {
		s.conn.Close()
		s.setConn(nil)
	}
	if s.ctx.Err() != nil {
		return s.ctx.Err()
	}
	if !retryable(e) {
		return e
	}
	if s.repair >= len(repairDelaysMs) {
		return &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	if s.repairUntil.IsZero() {
		s.repairUntil = time.Now().Add(time.Duration(timeoutRecovery) * time.Millisecond)
	}
	delay := time.Duration(repairDelaysMs[s.repair]) * time.Millisecond
	s.repair++
	if time.Now().Add(delay).After(s.repairUntil) {
		return &Error{Code: "KERNEL_UNAVAILABLE", Cause: e}
	}
	return wait(s.ctx, delay)
}

// Invoke 首次 Next 才登记/提交；单消费者 Next 可与 Close 并发。
// 接纳与已触发的取消由 client 持有，Close 仅中止观察，不撤销已写出的请求。
type Invocation struct {
	client          *Client
	ctx             context.Context
	input           InvokeInputWire
	env             KernelInvokeEnvironmentWire
	observation     context.Context
	stopObservation context.CancelFunc
	mu              sync.Mutex
	subscription    *Subscription
	record          *record
	stopWatch       func() bool
	cancelOnce      sync.Once
	cancelFinished  chan struct{}
	done            atomic.Bool
	started         bool
	pending         error
}

func (c *Client) Invoke(ctx context.Context, input InvokeInputWire, env KernelInvokeEnvironmentWire) *Invocation {
	observation, stop := context.WithCancel(context.Background())
	return &Invocation{client: c, ctx: ctx, input: input, env: env, observation: observation, stopObservation: stop, cancelFinished: make(chan struct{})}
}
func (i *Invocation) requestCancel(r *record) {
	i.cancelOnce.Do(func() {
		go func() {
			defer close(i.cancelFinished)
			_, _ = i.client.cancelRecord(context.Background(), r, "caller_aborted")
		}()
	})
}
func (i *Invocation) Close() error {
	i.done.Store(true)
	i.stopObservation()
	i.mu.Lock()
	r, subscription, stopWatch := i.record, i.subscription, i.stopWatch
	i.mu.Unlock()
	if stopWatch != nil {
		stopWatch()
	}
	if r != nil {
		if i.ctx.Err() != nil {
			i.requestCancel(r)
		}
		i.client.interrupted(r, nil)
	}
	if subscription != nil {
		return subscription.Close()
	}
	return nil
}
func (i *Invocation) start() error {
	if e := i.ctx.Err(); e != nil {
		return e
	}
	input, e := identify(i.input)
	if e != nil {
		return e
	}
	i.mu.Lock()
	if i.done.Load() {
		i.mu.Unlock()
		return io.EOF
	}
	r, e := i.client.begin(keyFor(object(input)))
	if e != nil {
		i.mu.Unlock()
		return e
	}
	i.input = input
	i.record = r
	i.stopWatch = context.AfterFunc(i.ctx, func() { i.requestCancel(r) })
	i.mu.Unlock()
	type admission struct {
		ref KernelRunRef
		err error
	}
	ready := make(chan admission, 1)
	// 即使观察先结束，也完成接纳修复，保存原 ref 并唤醒已登记的取消。
	go func() {
		ref, e := i.client.submit(i.ctx, input, i.env, r)
		if e != nil {
			i.client.rejected(r, e)
		} else {
			i.client.accepted(r, ref)
		}
		ready <- admission{ref, e}
	}()
	select {
	case <-i.observation.Done():
		return io.EOF
	case result := <-ready:
		if result.err != nil {
			return result.err
		}
		i.mu.Lock()
		defer i.mu.Unlock()
		if i.done.Load() {
			return io.EOF
		}
		i.subscription = i.client.Subscribe(i.observation, result.ref, 0)
		return nil
	}
}
func (i *Invocation) Next() (json.RawMessage, error) {
	if i.done.Load() {
		return nil, io.EOF
	}
	if i.pending != nil {
		e := i.pending
		i.pending = nil
		i.Close()
		return nil, e
	}
	if !i.started {
		i.started = true
		if e := i.start(); e != nil {
			i.Close()
			return nil, e
		}
	}

	for {
		frame, e := i.subscription.Next()
		if i.done.Load() {
			return nil, io.EOF
		}
		if e != nil {
			if errors.Is(e, io.EOF) {
				if i.ctx.Err() != nil {
					i.requestCancel(i.record)
					select {
					case <-i.cancelFinished:
					case <-i.observation.Done():
						return nil, io.EOF
					}
				}
				e = i.client.cancelError(i.observation, i.record)
				if i.done.Load() {
					return nil, io.EOF
				}
				if e == nil {
					e = i.ctx.Err()
				}
				if e == nil {
					e = io.EOF
				}
			}
			i.client.interrupted(i.record, e)
			i.Close()
			return nil, e
		}
		state := terminal(frame)
		m := object(frame)
		if state == "lost" {
			i.pending = &Error{Code: "RUN_OUTCOME_UNKNOWN"}
		}
		if i.input.ProtocolMode.Value == "canonical" {
			if m["kind"] == "canonical" {
				return raw(m["event"]), nil
			}
			ctrl, _ := m["control"].(map[string]any)
			switch ctrl["type"] {
			case "gap":
				e = &Error{Code: "STREAM_GAP"}
			case "error":
				e = &Error{Code: ctrl["code"].(string), Data: ctrl}
				snapshot, queryErr := i.client.Get(context.Background(), i.record.Key, i.subscription.ref.KernelInstanceId)
				if queryErr == nil && snapshot.Terminal.Set && terminal(snapshot.Terminal.Value) == "lost" {
					e = &Error{Code: "RUN_OUTCOME_UNKNOWN"}
				}
			}
			if e != nil {
				i.client.interrupted(i.record, e)
				i.Close()
				return nil, e
			}
			if i.pending != nil {
				e = i.pending
				i.pending = nil
				i.Close()
				return nil, e
			}
			continue
		}
		return frame, nil
	}
}
