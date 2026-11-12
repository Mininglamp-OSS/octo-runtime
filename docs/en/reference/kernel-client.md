# KernelClient Reference

[简体中文](../../zh-CN/reference/kernel-client.md) | [Documentation](../README.md)

Public SDK for an existing local Kernel. See [SDK Integration](../getting-started/sdk.md) for service creation and [Kernel IPC](kernel-ipc.md) for clients in other languages.

## attachKernel

### Example

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";

const client = attachKernel({ endpoint });
try {
  const run = client.invoke(
    { parts: [{ type: "text", text: "Inspect the project." }], protocol_mode: "canonical" },
    undefined,
    undefined,
    agentEnv
  );
  for await (const event of run) {
    console.log(event);
  }
} finally {
  client.close();
}
```

### Payload Definition

| Field | Type | Requirement |
| --- | --- | --- |
| `endpoint` | `string` | Required valid local Unix socket or Windows named pipe address. |

Returns KernelClient. attachKernel validates the address without starting a service; status() queries readiness. The caller supplies endpoint and agentEnv in the example.

### Notes

Standalone applications import the `@mininglamp-oss/octo-runtime-client` root; `/protocol` provides shared public types and validators. The client owns only its connections and invocation registry. close() neither cancels accepted work nor closes Kernel.

## KernelClient Methods

| Method                                                 | Purpose and result                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoke(inputs, sessionId, providerSession, agentEnv)` | Async output stream that submits when read, manages execution identifiers, and reconnects within limits. Use for normal calls.                 |
| `interrupt(invocationId, reason?)`                     | Cancel an invocation started through invoke on this client; returns `{accepted}`.                                                              |
| `respondInteraction(invocationId, response)`           | Reply to that invocation's canonical interaction.                                                                                              |
| `respondNativeInteraction(invocationId, response)`     | Reply to that invocation's Provider-native interaction.                                                                                        |
| `status()` / `list()`                                  | Query Kernel state or registered Adapter metadata with Provider probe results, respectively. Probing does not establish login or model access. |
| `close()`                                              | Close client connections without cancelling submitted executions or closing the Kernel service.                                                |

Use these lower-level methods only when managing submission and subscription yourself:

| Method                                                    | Purpose and result                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `submit(input, environment?)`                             | Submit one execution and return `{ref}`. The caller then subscribes to output and handles recovery.          |
| `get(key, expectedInstance?)`                             | Query the original execution's ref, retained output range, and final state.                                  |
| `subscribe(ref, afterSeq = 0, signal?)`                   | Read HostFrames after a sequence number. The signal only stops the subscription.                             |
| `cancel(ref, reason?)`                                    | Cancel by complete ref. The result says whether the request was accepted; read output for the final outcome. |
| `respond(ref, response)` / `respondNative(ref, response)` | Reply to an interaction by complete ref.                                                                     |

## Return Payloads

| Result | Field definitions |
| --- | --- |
| `KernelInvocation<T>` | Async iterator exposing invocationId, runId and sessionId immediately, submitting on first consumption. Native yields HostFrame; canonical yields CanonicalEvent. |
| `{accepted}` | boolean confirming only cancellation admission; observe the terminal result on the original stream. |
| `KernelStatus` | ipc_version is 2; kernel_instance_id is the current service-instance string; pid is a positive integer; execution_ready is boolean; optional service_processes contains resource snapshots. |
| `HostedAdapterMetadata[]` | Each entry contains type, workspace, processModel, transport, protocolSupport, available and optional unavailableReason, providerPath and providerVersion. No model catalog or proof of login/model access. |
| `RunSnapshot` | ref is the complete RunRef; oldest_seq is a positive safe integer, latest_seq a nonnegative safe integer; optional terminal is the final HostFrame. |
| `RunRef` | kernel_instance_id plus run_id, invocation_id, stream_id, agent_session_id, session_generation, protocol_mode and protocol from the receipt. Preserve the object unchanged. |

See [Invoke API](invoke-input.md) for content, session and configuration fields; [Output and Control](output-and-control.md) defines interaction-response payloads, timing and acceptance.

## Manage Unfinished Client Invocations

`client.invocations` tracks up to 128 calls started through `invoke`, including calls with unknown outcomes. Lower-level `submit` is not added automatically.

- `snapshot()` returns invocation metadata.
- `stopAdmission()` rejects new invoke calls.
- `drain({deadline, reason})` cancels and awaits tracked calls, returning `complete` and `unresolved`. Its deadline is an absolute millisecond timestamp calculated with `Date.now()`.

Applications that create Kernel normally use the service's `close()`. An application connected to an external Kernel can explicitly use this registry to cancel and await its own invocations on exit.

## Notes

Ordinary applications use invoke for submission identities and bounded observation recovery. Low-level submit/subscribe callers preserve complete references and continuous sequence numbers and manage cancellation and tail observation. Never automatically repeat controls with unknown outcomes. See [Kernel IPC](kernel-ipc.md) for replay and buffer limits.

Applications obtain model choices from their Provider, endpoint and account. list() probes registered Adapters and does not discover model catalogs or authorize execution.

Sources: [client types](../../../packages/octo-runtime-client/src/types.ts), [implementation](../../../packages/octo-runtime-client/src/client.ts), [protocol schema](../../../packages/octo-runtime-protocol/schema/protocol.schema.json).
