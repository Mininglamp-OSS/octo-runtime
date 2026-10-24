package octo

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// InvocationRecord 只保存身份/游标，未知执行继续占用登记额度。
type InvocationRecord struct {
	Key              KernelLookupKey `json:"key"`
	Ref              *KernelRunRef   `json:"ref,omitempty"`
	Phase            string          `json:"phase"`
	Cancellation     string          `json:"cancellation"`
	LastSeq          int64           `json:"lastSeq"`
	ObservationError string          `json:"observationError,omitempty"`
}
type record struct {
	InvocationRecord
	instance      string
	submitted     bool
	observing     bool
	admitted      chan struct{}
	admissionOnce sync.Once
	admissionErr  error
	cancelDone    chan struct{}
	cancelResult  IpcCancelResult
	cancelErr     error
	reason        string
}
type DrainResult struct {
	Complete   bool               `json:"complete"`
	Unresolved []InvocationRecord `json:"unresolved"`
}

func (c *Client) StopAdmission() { c.mu.Lock(); c.stopped = true; c.mu.Unlock() }
func (c *Client) Invocations() []InvocationRecord {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make([]InvocationRecord, 0, len(c.records))
	for _, r := range c.records {
		v := r.InvocationRecord
		if r.Ref != nil {
			ref := *r.Ref
			v.Ref = &ref
		}
		result = append(result, v)
	}
	return result
}
func (c *Client) begin(key KernelLookupKey) (*record, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped {
		return nil, &Error{Code: "CLIENT_INVOCATION_ADMISSION_CLOSED"}
	}
	if c.records[key.InvocationId] != nil {
		return nil, &Error{Code: "EXECUTION_IDENTITY_CONFLICT"}
	}
	if len(c.records) >= limitInvocations {
		return nil, &Error{Code: "CLIENT_INVOCATION_CAPACITY_EXHAUSTED"}
	}
	r := &record{InvocationRecord: InvocationRecord{Key: key, Phase: "admitting", Cancellation: "none"}, admitted: make(chan struct{}), observing: true}
	c.records[key.InvocationId] = r
	return r, nil
}
func (c *Client) accepted(r *record, ref KernelRunRef) {
	c.mu.Lock()
	r.Ref = &ref
	r.instance = ref.KernelInstanceId
	if r.observing {
		r.Phase = "accepted"
	} else {
		r.Phase = "unobserved"
	}
	r.admissionOnce.Do(func() { close(r.admitted) })
	c.mu.Unlock()
}
func (c *Client) rejected(r *record, e error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r.admissionErr = e
	r.Phase = "acceptance_unknown"
	r.ObservationError = code(e)
	r.admissionOnce.Do(func() { close(r.admitted) })
	remote, ok := e.(*Error)
	if !r.submitted || (ok && remote.Remote && remote.Code != "RUN_IDENTITY_MISMATCH" && remote.Code != "KERNEL_INSTANCE_CHANGED") {
		delete(c.records, r.Key.InvocationId)
	}
}
func (c *Client) interrupted(r *record, e error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r.observing = false
	if c.records[r.Key.InvocationId] != r || r.Ref == nil {
		return
	}
	r.Phase = "unobserved"
	if e != nil {
		r.ObservationError = code(e)
	}
}
func (c *Client) observe(ref KernelRunRef, frame HostFrame) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.records[ref.InvocationId]
	if r == nil || r.Ref == nil || *r.Ref != ref {
		return
	}
	seq := numeric(object(frame)["seq"])
	if seq > r.LastSeq {
		r.LastSeq = seq
	}
	state := terminal(frame)
	if state == "lost" {
		r.Phase = "unobserved"
		r.ObservationError = "RUN_OUTCOME_UNKNOWN"
	} else if state != "" {
		delete(c.records, ref.InvocationId)
	}
}
func (c *Client) reconcile(s KernelRunSnapshot) {
	c.mu.Lock()
	r := c.records[s.Ref.InvocationId]
	if r == nil || (r.instance != "" && r.instance != s.Ref.KernelInstanceId) || !same(object(r.Key), object(s.Ref), lookupFields) {
		c.mu.Unlock()
		return
	}
	if r.Ref != nil && *r.Ref != s.Ref {
		c.mu.Unlock()
		return
	}
	r.Ref = &s.Ref
	r.instance = s.Ref.KernelInstanceId
	r.admissionOnce.Do(func() { close(r.admitted) })
	c.mu.Unlock()
	if s.Terminal.Set {
		c.observe(s.Ref, s.Terminal.Value)
	}
}
func (c *Client) CancelInvocation(ctx context.Context, id, reason string) (IpcCancelResult, error) {
	c.mu.Lock()
	r := c.records[id]
	c.mu.Unlock()
	if r == nil {
		return IpcCancelResult{}, &Error{Code: "INVOCATION_NOT_TRACKED"}
	}
	return c.cancelRecord(ctx, r, reason)
}

// 同一登记只启动一次控制；原调用期限与 client 的首次排空期限共同约束接纳等待和 IO。
// 截止后即使拿到额度也不得重发；ACK 未确认保留 unknown，不能据此释放执行登记。
func (c *Client) cancelRecord(ctx context.Context, r *record, reason string) (IpcCancelResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(c.controlCtx, cancel)
	defer stop()
	defer cancel()
	c.mu.Lock()
	if r.reason == "" {
		r.reason = reason
	}
	if r.Cancellation == "none" {
		r.Cancellation = "requested"
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return IpcCancelResult{}, ctx.Err()
	case <-r.admitted:
	}
	c.mu.Lock()
	if r.Ref == nil {
		e := r.admissionErr
		c.mu.Unlock()
		return IpcCancelResult{}, e
	}
	if r.ObservationError == "RUN_OUTCOME_UNKNOWN" {
		c.mu.Unlock()
		return IpcCancelResult{}, &Error{Code: "RUN_OUTCOME_UNKNOWN"}
	}
	if c.records[r.Key.InvocationId] != r {
		c.mu.Unlock()
		return IpcCancelResult{}, nil
	}
	if r.cancelDone != nil {
		done := r.cancelDone
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return IpcCancelResult{}, ctx.Err()
		case <-done:
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		return r.cancelResult, r.cancelErr
	}
	r.cancelDone = make(chan struct{})
	ref := *r.Ref
	reason = r.reason
	c.mu.Unlock()
	var result IpcCancelResult
	var e error
	select {
	case c.controls <- struct{}{}:
		// 首次 drain 同时收紧既有排队任务；拿到额度后仍检查期限，避免取消与额度同时就绪时发出 IO。
		c.mu.Lock()
		until := c.controlDeadline
		c.mu.Unlock()
		if c.controlCtx.Err() != nil || (!until.IsZero() && !time.Now().Before(until)) {
			e = &Error{Code: "DRAIN_DEADLINE_EXCEEDED"}
		} else {
			if !until.IsZero() {
				var release context.CancelFunc
				ctx, release = context.WithDeadline(ctx, until)
				defer release()
			}
			result, e = c.Cancel(ctx, ref, reason)
		}
		<-c.controls
	case <-ctx.Done():
		e = ctx.Err()
	}
	c.mu.Lock()
	r.cancelResult = result
	r.cancelErr = e
	if e == nil {
		r.Cancellation = "acknowledged"
	} else {
		r.Cancellation = "unknown"
	}
	close(r.cancelDone)
	c.mu.Unlock()
	return result, e
}
func (c *Client) cancelError(observation context.Context, r *record) error {
	c.mu.Lock()
	done := r.cancelDone
	c.mu.Unlock()
	if done != nil {
		// 关闭观察只停止等待；控制任务继续持有原取消及其结果。
		select {
		case <-done:
		case <-observation.Done():
			return observation.Err()
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return r.cancelErr
}
func (c *Client) RespondInteraction(ctx context.Context, id string, response InteractionResponseWire) error {
	ref, e := c.trackedRef(id)
	if e != nil {
		return e
	}
	return c.Respond(ctx, ref, response)
}
func (c *Client) RespondNativeInteraction(ctx context.Context, id string, response NativeInteractionResponse) error {
	ref, e := c.trackedRef(id)
	if e != nil {
		return e
	}
	return c.RespondNative(ctx, ref, response)
}
func (c *Client) trackedRef(id string) (KernelRunRef, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.records[id]
	if r == nil {
		return KernelRunRef{}, &Error{Code: "INVOCATION_NOT_TRACKED"}
	}
	if r.Ref == nil {
		return KernelRunRef{}, &Error{Code: "INVOCATION_NOT_ACCEPTED"}
	}
	return *r.Ref, nil
}

// Drain 使用绝对 until 与 ctx 的较早期限，并约束此前已排队的取消；重复调用共享首次结果。
// 不新增订阅，只有确认终态才释放登记；Complete=false 时由 owner 处理 Unresolved。
func (c *Client) Drain(ctx context.Context, until time.Time, reason string) DrainResult {
	c.mu.Lock()
	if c.drainDone != nil {
		done := c.drainDone
		c.mu.Unlock()
		<-done
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.drainResult
	}
	c.stopped = true
	c.drainDone = make(chan struct{})
	c.controlDeadline = until
	c.mu.Unlock()
	budget, cancel := context.WithDeadline(ctx, until)
	defer cancel()
	stop := context.AfterFunc(budget, c.controlCancel)
	defer stop()
	defer c.controlCancel()
	for budget.Err() == nil {
		records := c.Invocations()
		if len(records) == 0 {
			break
		}
		jobs := make(chan InvocationRecord)
		var wg sync.WaitGroup
		for n := 0; n < limitLookupConcurrency; n++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for item := range jobs {
					if budget.Err() != nil {
						return
					}
					c.mu.Lock()
					r := c.records[item.Key.InvocationId]
					instance := ""
					if r != nil {
						instance = r.instance
					}
					c.mu.Unlock()
					if r == nil || instance == "" {
						continue
					}
					snapshot, e := c.Get(budget, item.Key, instance)
					if e == nil && (!snapshot.Terminal.Set || terminal(snapshot.Terminal.Value) == "") {
						_, _ = c.cancelRecord(budget, r, reason)
					}
				}
			}()
		}
		for _, r := range records {
			select {
			case jobs <- r:
			case <-budget.Done():
			}
		}
		close(jobs)
		wg.Wait()
		if wait(budget, 100*time.Millisecond) != nil {
			break
		}
	}
	result := DrainResult{Unresolved: c.Invocations()}
	result.Complete = len(result.Unresolved) == 0
	c.mu.Lock()
	c.drainResult = result
	close(c.drainDone)
	c.mu.Unlock()
	return result
}

var _ json.RawMessage
