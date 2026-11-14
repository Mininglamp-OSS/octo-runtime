# Output and Control

KernelClient streams observe admitted work. Ending observation does not cancel execution; request cancellation explicitly and consume its outcome before closing owned connections. A terminal event is separate from resource cleanup. Closing a direct Core execution iterator early requests cancellation.

[简体中文](../../zh-CN/reference/output-and-control.md) | [Documentation](../README.md)

## Output Modes

Use `protocol_mode` to select the return format of `client.invoke`:

- `canonical` returns common `CanonicalEvent` objects, allowing the same application code to handle different Providers.
- `native` returns `HostFrame` objects with Provider-native messages and Runtime control information, for applications that need the native protocol.

The default is `native`, but some Adapters support only `canonical`. For most integrations, explicitly set `protocol_mode: "canonical"`. Once an invocation starts, reconnection must use its original mode.

## Determine When Execution Ends

For canonical output, check the final event: `run.completed` means success, `run.failed` means failure, and `run.cancelled` means cancellation. Execution failures may arrive as events without throwing, so handle events as well as errors thrown while reading. [invokeOnce](../../examples/invoke.mts) demonstrates both.

For HostFrame output, use public `isHostTerminal` to identify Runtime's final status. States are `running`, `completed`, `failed`, `cancelled`, and `lost`. A terminal cannot replace resource cleanup confirmation; hosts must inspect their owned service’s close result separately.

`lost` means the execution outcome cannot be determined; KernelClient reports `RUN_OUTCOME_UNKNOWN`. Missing final status, output loss and cleanup failure alone never prove success. Your application separately confirms whether results were saved, messages delivered, or the UI updated.

Codex can confirm `completed` through a 15-second finalization fallback after a nonempty completed `final_answer`, provided no work or synchronous interaction remains. New work, cancellation or a known error invalidates eligibility. An accepted completed result survives later interrupt/unsubscribe failure; cleanup remains independently failed/incomplete. Other Adapters retain their existing completion rules. A turn's release does not close the resident app-server.

## CanonicalEvent

### Example

```json
[
  { "protocolVersion": 2, "type": "message.delta", "payload": { "messageId": "m1", "channel": "final", "text": "Done." } },
  { "protocolVersion": 2, "type": "tool_call.create", "payload": { "id": "t1", "name": "read_file", "args": { "path": "README.md" }, "status": "running" } },
  { "protocolVersion": 2, "type": "tool_call.update", "payload": { "id": "t1", "status": "completed", "output": "Project description." } },
  { "protocolVersion": 2, "type": "run.completed", "payload": {} }
]
```

### Payload Definition

Events require `protocolVersion: 2`, `type` and an object `payload`. All 23 event types are listed below, followed by types and required-field constraints.

| Type                    | Group       | When it appears                                            | Key payload fields                                                                                                   |
| ----------------------- | ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `run.queued`            | run         | Accepted and waiting; reserved, no built-in producer today | —                                                                                                                    |
| `run.started`           | run         | Execution begins; reserved like `run.queued`               | —                                                                                                                    |
| `run.completed`         | run         | Normal end — the only success terminal                     | —                                                                                                                    |
| `run.failed`            | run         | Execution failed                                           | `message`, `code`, `adapterType`; a normalized `failure` may be attached                                             |
| `run.cancelled`         | run         | Cancelled, or the stream was aborted                       | —                                                                                                                    |
| `message.create`        | message     | A message starts                                           | `messageId`, `role`, `channel`                                                                                       |
| `message.delta`         | message     | Incremental text                                           | `text`, `channel`, `messageId`                                                                                       |
| `message.update`        | message     | Full replacement or status change                          | `text`, `status`, `messageId`                                                                                        |
| `model_step.started`    | step        | One model round begins                                     | `stepId`, `startedAtMs`                                                                                              |
| `model_step.finished`   | step        | That round ends                                            | `stepId`, `status`, `finishReason`                                                                                   |
| `tool_call.create`      | tool        | A tool call starts                                         | `id`, `name`, `args`, `status: "running"`                                                                            |
| `tool_call.delta`       | tool        | Streaming argument or output fragment                      | `id`, and one of `argsDelta`, `outputDelta`, `outputSnapshot`                                                        |
| `tool_call.update`      | tool        | Tool call reaches a terminal status                        | `id`, `status`, `output`, `error`, `exitCode`                                                                        |
| `tool_call.progress`    | tool        | Long-running progress                                      | `id`, `progress` (`message`, `completed`, `total`, `unit`)                                                           |
| `activity.started`      | activity    | Thinking, executing, waiting for approval or input         | `activityId`, `kind`, `subject`, `source`, `info`                                                                    |
| `activity.updated`      | activity    | Activity details refreshed                                 | `activityId`, `info`                                                                                                 |
| `activity.finished`     | activity    | Activity ends                                              | `activityId`, `status`                                                                                               |
| `plan.updated`          | plan        | Whole plan replaced                                        | `planId`, `revision`, `steps[]`                                                                                      |
| `run.notice`            | notice      | Retry, compaction, reroute, configuration warning, model output silence          | `noticeId`, `code`, `severity`, `params`                                                                             |
| `interaction.requested` | interaction | Needs approval, an answer, or more input                   | `interactionId`, `kind`, `expiresAt`, `request`                                                                      |
| `interaction.resolved`  | interaction | Handled, expired, or invalidated                           | `interactionId`, `status`, `outcome`, `reasonCode`                                                                   |
| `session.update`        | state       | Provider session data changed                              | `providerSession`                                                                                                    |
| `usage.update`          | state       | Token usage for this turn                                  | Adapter-normalized counts such as `inputTokens` and `outputTokens`, optionally `cumulative` and `modelContextWindow` |

| Payload fields | Definition |
| --- | --- |
| Message fields | messageId, role and text are strings; channel is analysis/commentary/final; exposure is public_reasoning/public_summary/public_plan/private_reasoning/unknown. Providers may add structured fields. |
| `model_step.started / finished` | Required nonempty stepId; finished requires status=completed/failed/cancelled. Optional startedAtMs/endedAtMs are positive safe integers; finished may include string finishReason. |
| `tool_call.create` | Required nonempty id/name, object args and status="running". |
| `tool_call.delta` | Nonempty id and at least one string argsDelta/outputDelta/outputSnapshot. Concatenate argsDelta in order before parsing; outputSnapshot replaces the whole output. |
| `tool_call.update` | Required id and terminal status=completed/failed/cancelled; optional JSON output, object error, integer exitCode and nonnegative safe-integer durationMs. |
| `tool_call.progress` | Required id and progress object; progress may contain message (4096 code points), completed (nonnegative safe integer), total (positive safe integer) and unit=items/bytes/steps. |
| `activity.started` | Required activityId, kind, subject, source and info; kind is starting/thinking/executing_tool/responding/waiting_approval/waiting_input/compacting/retrying/working; source is provider/harness. Optional startedAtMs. |
| `activity.updated / finished` | updated requires activityId/info; finished requires activityId and status=completed/failed/cancelled/superseded, with optional endedAtMs. Activity timestamps are nonnegative safe integers. |
| `plan.updated` | Required planId, positive safe-integer revision, explanation (string or null), and steps (up to 200). Each step has nonempty text (4096 code points) and status=pending/in_progress/completed/blocked/cancelled. |
| `run.notice` | Required noticeId, code, severity=info/warning and params object; code is retry_scheduled/context_compacted/model_rerouted/config_warning/provider_diagnostic/model_output_idle. params values are string/number/boolean; optional relatedActivityId/relatedItemId. |
| `interaction.requested / resolved` | See interactions below; required nonempty interactionId and executionInstanceId, up to 191 code points. |
| `session.update` | providerSession is the complete ProviderSession to preserve for explicit recovery; see [Invoke API](invoke-input.md). |
| `usage.update` | Adapter counts such as inputTokens/outputTokens, with optional cumulative/modelContextWindow; missing fields do not imply zero. |

activityId, planId, progress id and noticeId permit 191 code points. See the [protocol schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json) for nested subject, info, provenance and failure shapes. Payload openness and event-specific semantics are validated separately; required fields differ between event types.

### Notes

run.queued and run.started are reserved without built-in producers. Only run.completed/run.failed/run.cancelled are canonical terminal events. Messages, tool completion, cancellation ACK, process exit and stream EOF do not establish Run success.

Final text can arrive before the terminal result. Analysis is public only with public_reasoning, public_summary or public_plan exposure. Associate events using messageId, stepId and tool id rather than textual similarity.

## HostFrame Structure

HostFrame includes execution and session identifiers: `run_id`, `invocation_id`, `stream_id`, `agent_session_id`, and `session_generation`, plus `protocol_mode` and `protocol`. Its `seq` starts at 1 and identifies the output position for reading after a disconnect.

There are three frame kinds: `native` preserves Provider data and extension fields, `canonical` holds a common event in `event`, and `control` reports state, errors, interaction status, and missing output. All three share the same `seq` numbering. If implementing an IPC client, save frame sequence numbers rather than counting canonical events to determine your position.

### Payload Definition

| Field | Type and meaning |
| --- | --- |
| `run_id / invocation_id / stream_id / agent_session_id` | Required nonempty strings, up to 256 code points each, from the original receipt. |
| `session_generation` | Required nonnegative safe integer. |
| `protocol_mode` | Required native or canonical; required nonempty protocol permits 128 code points. |
| `seq` | Required positive safe integer shared continuously by all frame kinds. |
| `kind` | native/canonical/control, selecting the payload below. |
| `messageKind / payload` | Required for native: messageKind=response/notification/request/message; payload is a native Provider object. |
| `event` | Required for canonical: a complete CanonicalEvent. |
| `control` | Required for control, defined below. |

| control.type | Payload |
| --- | --- |
| `state` | state=running/completed/failed/cancelled/lost. |
| `error` | String code/message, optional normalized failure. |
| `interaction` | Nonempty string or safe-integer requestId; status=pending/resolved/expired/invalidated; pending requires positive safe-integer expiresAt in Unix milliseconds and allows responseRequired. |
| `gap` | requested_after_seq, oldest_seq and latest_seq report a missing replay window. |
| `evidence` | name="session", with a session-evidence object payload. |

### Notes

Native request IDs and canonical interactionIds use their respective response APIs. control.error, gap and lost may throw from the high-level view; handle stream exceptions as well as event terminal results.

## Model Output Silence Notices

The first interval starts when Core begins this invocation of the Adapter. During continuous silence with normal consumption, Runtime emits a new `run.notice` with code `model_output_idle` at 60, 120, 180 seconds and subsequent minute boundaries. Each new notice has a unique noticeId. Boundaries use the same source interval start, never the notice delivery or Gateway receive time. A new text delta or growing text snapshot restarts the full 60 seconds and subsequent periods. Empty content, duplicate or shorter snapshots, heartbeats, usage, and private reasoning do not reset the clock. Queueing, tool execution, and synchronous approval/input waits pause observation; the last wait ending starts a fresh interval. Asynchronous questions do not pause it.

Once the threshold has been reached and a notice generated, new output resets the next interval without revoking that queued fact. The notice is delivered before an ordinary model output that becomes ready at the same time. Terminal events, cancellation, and errors still take priority and clear undelivered notices.

`silenceMs` is the elapsed time measured by Runtime's monotonic clock when the notice is generated; a late timer may exceed the intended boundary. The message uses its whole seconds, for example `120s no LLM output`. Each invocation keeps one pending slot and runs no notice timer without a waiter or while that slot is occupied. Backpressure does not rewrite an existing fact: a pending 60-second notice taken at 190 seconds still reports 60, with the next boundary at 240. If 60 was already delivered and listening resumes at 190, at most one new notice reports about 190, also followed by 240. A timer that misses several boundaries emits only one current measurement, never a burst of historical minutes. An older interval's pending slot does not advance a newer interval's schedule.

These periodic silence notices are neither terminals, cancellation requests, nor transport keepalive heartbeats. Public-text silence and Watchdog model-idle progress use different clocks. Notices do not count as model progress or extend or reset any budget. Existing budgets still apply: the default policy is `enforce`, and the 60-second first-frame timeout may fail first. Explicit `model_idle_policy: observe` remains valid and only disables model-idle termination, leaving first-frame, total-run, and tool budgets active.

Gateway updates the original card from each source notice. It must not maintain its own silence timer, add delivery latency to the reported seconds, or cancel for local silence. The connected Runtime service must contain this periodic implementation; upgrading only the client or having the notice type does not give an older service subsequent same-interval notices. Verify versions and actual channel acceptance separately.

The canonical view from `client.invoke` receives:

```json
{
  "protocolVersion": 2,
  "type": "run.notice",
  "payload": {
    "noticeId": "idle-1",
    "code": "model_output_idle",
    "severity": "info",
    "params": {
      "silenceMs": 60000,
      "message": "60s no LLM output"
    }
  }
}
```

IPC reuses the existing JSON-RPC 2.0 `agent_run.event` notification without an `id`. `params.event` is the original HostFrame; its nested `event` contains the same notice:

```json
{
  "jsonrpc": "2.0",
  "method": "agent_run.event",
  "params": {
    "kernel_instance_id": "kernel-1",
    "run_id": "run-1",
    "stream_id": "stream-1",
    "seq": 8,
    "event": {
      "run_id": "run-1",
      "invocation_id": "invocation-1",
      "stream_id": "stream-1",
      "agent_session_id": "session-1",
      "session_generation": 1,
      "seq": 8,
      "protocol_mode": "canonical",
      "protocol": "codex.app-server",
      "kind": "canonical",
      "event": {
        "protocolVersion": 2,
        "type": "run.notice",
        "payload": {
          "noticeId": "idle-1",
          "code": "model_output_idle",
          "severity": "info",
          "params": {
            "silenceMs": 60000,
            "message": "60s no LLM output"
          }
        }
      }
    }
  }
}
```

Replay preserves identity, sequence and measurements without restarting timing. Silence notices apply only to canonical output. They do not guarantee that network intermediaries keep connections open; see [Kernel IPC](kernel-ipc.md) for recovery.

## Cancellation

Use `client.interrupt(run.invocationId, reason?)` on the client that created the handle. There is no public invoke signal parameter. Identity is available immediately; before submission interruption prevents sending, while after submission it controls the original execution and preserves observation of the tail.

An accepted ACK is not a terminal or cleanup confirmation. Keep consuming the original stream. For accepted KernelClient calls, break/return/throw/close only end observation. Before submission, return/throw release the local reservation. Direct Core execution iterators retain their internal cancellation contract. See [identifier ownership](../concepts/identifiers.md).

## Reply to Approvals and User Questions

> **Interaction handling requirement:** Check `payload.delivery` before registering or presenting an interaction. `delivery: "async"` is optional supplemental input, not a blocking question. Do not route it into an existing synchronous form, `/respond` command, or waiting-state handler without implementing the async contract below.

In canonical mode, `interaction.requested` carries `interactionId`, `executionInstanceId`, and `request`. Its `kind` is `approval`, `question`, or `elicitation`, which requests additional user information. Synchronous requests require `expiresAt` (an ISO timestamp); async questions may omit it. The following response flow describes synchronous interactions:

1. Present `request` in the application's interaction UI.
2. Collect the user's decision or answer.
3. Call `client.respondInteraction(invocationId, response)` on the original client.
4. Continue reading events until execution ends.

The shared [interaction example](../../examples/interactions.mts) follows this flow with an application-supplied decision function. Do not automatically approve requests based on ordinary Context text.

An approval response contains `{interactionId, outcome}`, for example `accepted`, `declined`, or `cancelled`. Questions and elicitation use `outcome: "answered"`, with `value` filled according to the request. See the [InteractionResponse type and validator](../../../packages/octo-runtime-protocol/src/index.ts) for the exact format. Responses must match the original request without expanding its permission scope.

In native mode, save the Provider request ID and call `respondNativeInteraction(invocationId, {requestId, payload})`. The `payload` must match that Provider's response format for the pending request. The Driver still manages initialization and the current turn. This API cannot start another turn or change accounts, global configuration, or arbitrary threads.

HostFrame control messages report interaction states: `pending`, `resolved`, `expired`, and `invalidated`. A pending control uses a Unix timestamp in milliseconds for its deadline. After a response is accepted, subsequent notifications update its state. Replies fail if the request expired, was already answered, belongs to an old execution, uses the wrong mode, or its execution ended. Cancellation or execution loss also invalidates pending interactions.

The `full_access` policy can handle supported approvals, but does not answer user questions or requests for additional information.

### Async Question Contract

Codex can emit `interaction.requested` with `kind: "question"` and `delivery: "async"` while continuing work. Keep reading events while the form is open. Its request is `{schema: "octo.question-request/v1", messageId, questions: [{id, title, options, allowCustom: true}]}`. Options may be `null` or empty; custom text is always allowed. The original request and host-owned pending state authorize a reply; a message snapshot alone does not. Associate both by `messageId` to display one form.

Submit the entire batch once: `outcome: "answered"`, `value: {schema: "octo.question-response/v1", answers: [{questionId: "q:0", text: "option or custom answer"}]}`. Supply every positional question ID exactly once. Each answer must be nonblank and at most 4096 Unicode code points. See [asyncQuestionForm](../../examples/interactions.mts), which imports only public SDK APIs.

Runtime sends one `turn/steer` to the original active turn. The Promise succeeds and `interaction.resolved` reports `resolved/answered/provider_accepted` only after a matching RPC reply. This proves acceptance, not persistence, model consumption, or task completion. `ASYNC_ANSWER_REJECTED` means explicit rejection; `OPERATION_OUTCOME_UNKNOWN` means sent but unconfirmed. Do not automatically retry either. `INVALID_QUESTION_RESPONSE` permits correction before sending; `INTERACTION_NOT_ACTIVE` rejects duplicate or inactive answers.

Async ask is optional supplemental input. Leaving it unanswered does not block completion. The public `/executor-kernel` `AsyncQuestionReply` steers the original active run, or uses the existing `client.invoke` to create a new AgentRun after confirmed normal completion. The host supplies current continuation input with the same session/generation/provider binding and its explicitly selected agentEnv. The SDK assigns new execution IDs and replaces input with the original questions and answers. Codex continuation sets `providerSession.requireResume=true`: failed resume fails instead of starting a fresh provider session.

A `route: "steer"` response confirms provider acceptance. A `route: "new_run"` response supplies an `events` stream: consumption starts submission, and returning the stream does not confirm delivery. Runtime admission, provider acceptance, model consumption, and completion are separate facts. See [asyncSupplementForm](../../examples/interactions.mts). Low-level respond still targets active runs only.

Async questions have no default expiry; optional `expiresAt` is enforced, while synchronous interactions still require a deadline. Cancellation dismisses the form without cancelling model work. A single host controller owns storage and calls `observe` on original terminal/interaction frames before saving `snapshot()`. A persisted pending/completed snapshot can start a continuation after restart; a running or unknown submission cannot be replayed. Mismatched supplied session identities/generations reject stale forms; the next section defines application binding ownership separately from configuration changes. Unknown steer delivery never falls back to a new Run or retries. The SDK provides neither a host database transaction nor exactly-once delivery across controllers.

The shared limit is 16 active interactions, with at most 50 questions per batch, 50 options per question, and 4096 code points per title/option. Oversized or malformed snapshots fail explicitly. Synchronous questions, elicitation, approvals and `full_access` behavior remain unchanged. Host UI integration is still required; no Markdown parsing is needed.

### Applications Own Continuation Configuration

`agentEnv` is per-invocation configuration, not session identity. Runtime does not fingerprint the entire envelope or require cross-run equality; a change alone does not invalidate an old question. Hosts may explicitly authorize different effort, refreshed environment variables, MCP settings, approval policy or a workdir for the next run. Execution permission checks and Provider configuration/resume limitations still apply.

| Situation | Configuration and ownership |
| --- | --- |
| Original Run is active | Steer the original RunRef/interactionId; continuation agentEnv cannot modify or redirect it |
| Original Run has confirmed normal completion | The host selects and authorizes the next agentEnv through continuation; the SDK creates new execution IDs and requires the original Provider session to resume |
| Session reset or Provider binding replacement | The host isolates old forms; mismatched supplied sessionId/generation, Provider sessionId or epoch causes SDK rejection |
| Target or authorization cannot be confirmed | The host rejects continuation; unchecked global “current configuration” is not continuation authorization |

`providerEpoch` remains optional and is maintained when the application identifies a Provider binding replacement, not on every agentEnv edit. Hosts using it must save the original value in the question snapshot. Both values being absent means this version protection is absent. The SDK does not detect Adapter, account, server or external configuration changes hidden behind identical IDs. Hosts omitting epoch must still invalidate old forms/controllers on binding replacement; an original providerSession must not be sent to another Provider identity domain.

`respond()` reads and copies continuation input, including agentEnv. When the returned events stream is first consumed, it calls continuation again to check session identities/generations before submitting the run. This second read does not replace the captured agentEnv. Hosts must recheck their own business authorization before submission and consumption, throwing from the callback when needed. SDK identity checks do not replace authorization or provide transactions across business storage. Select different configuration before calling respond if that configuration should be used.

“Stale binding” therefore does not mean configuration must remain permanently unchanged. A continuation is a new execution authorized by the application; failed resume fails explicitly, and configuration changes never justify replaying unknown delivery. This contract does not claim that every external application already maintains epochs correctly; each must verify its binding-change and form lifecycle policy.

### Required Handling in Applications

**Every application that consumes interaction events must explicitly choose one of these policies:**

- **Without async form support:** Ignore async `interaction.requested` before interaction registration, secret-input handling, command/card generation, or waiting-state projection. Track its `interactionId` within the original Run and also ignore its `interaction.resolved`, which does not carry `delivery`. Continue consuming the stream, advance the original cursor, and display ordinary message text. Do not submit an automatic answer, pause execution, or let an ignored resolution clear a synchronous interaction's waiting state. Bound and clean up the identity tracking with the Run.
- **With async form support:** Preserve the original request, question IDs, provider/session binding and submission state. Collect a complete `octo.question-response/v1` batch, support custom text and cancellation, and use the public `AsyncQuestionReply` lifecycle above. Handle expiry, duplicate submissions, stale bindings, restart and unknown delivery explicitly. Active runs use steer; confirmed normal completion permits a new AgentRun in the same session. Report delivery only when the provider accepts it.

Missing async `expiresAt` is valid, not evidence of expiry; async replies require the structured batch. `delivery` controls this distinction, not `kind`, `full_access`, message wording, or the presence of options. `responseRequired: false` is reserved for automatic approvals and is not an async-question discriminator.

Each business UI chooses its own asynchronous question display and response policy; protocol support does not imply UI support.

## Errors and Recovery

Record the error object's stable code before choosing recovery. For example, fix parameters for input errors and query the original execution after an output disconnect. If a submission receipt is lost, the Provider may already be working; retrying `invoke` can execute the task twice. See [Kernel IPC](kernel-ipc.md) for reconnection and [Troubleshooting](../guides/troubleshooting.md) for common errors.

Sources: [frame validation and canonical view](../../../packages/octo-runtime-protocol/src/run-protocol.ts), [event types](../../../packages/octo-runtime-protocol/src/index.ts), [Kernel client](../../../packages/octo-runtime-executor-kernel/src/client.ts).
