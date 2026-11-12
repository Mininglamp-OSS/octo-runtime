# Executor Core

[简体中文](README.zh.md) | [Packages](../README.md)

AgentExecutor implements Runtime execution for Kernel integration and low-level execution tests. Standard applications use [KernelClient](../../docs/en/reference/kernel-client.md). This is a private source-workspace dependency.

## Minimal Usage

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter); // metadata.type is "dsh"; a duplicate type throws

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
  }
});

try {
  let terminal: string | undefined;
  for await (const event of executor.invoke({ ...input, protocol_mode: "canonical" })) {
    if (event.type === "message.delta" && event.payload.channel === "final")
      process.stdout.write(event.payload.text ?? "");
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
    if (event.type === "run.failed") throw new Error(JSON.stringify(event.payload));
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const { cleanup } = await executor.shutdown();
  if (cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

## Package API

| Method | Responsibility |
| --- | --- |
| register(adapter) | Register by metadata.type; reject duplicates. |
| list() / describe(configurations?) | List registration metadata; describe probes the bound target without proving model access. |
| invoke(input, environment?) | Return output in the selected mode. |
| invokeFrames(input, environment?) | Preserve HostFrame and sequence numbers. |
| cancel(invocationId) | Request cancellation, confirming admission only. |
| respondInteraction / respondNative | Respond to an active interaction of its owning invocation. |
| shutdown(reason?, timeoutMs?) | Stop admission, wait for owned cleanup and return a cleanup snapshot. |

Ending a direct Core iterator early requests cancellation; see KernelClient for its observation semantics. invokeFrames validates at call time and invoke at first consumption; catch errors around the consumption loop. shutdown state=closed means admission is closed; cleanup=complete confirms its owned resources are released. Hosts and Adapters explicitly agree shared Engine ownership.

## References and Implementation

- [Invoke API](../../docs/en/reference/invoke-input.md), [Inputs](../../docs/en/reference/input-parts.md), [AgentEnv Standard Reference](../../docs/en/reference/agent-env-standard.md).
- [Output and Interactions](../../docs/en/reference/output-and-control.md), [Adapter Configuration](../../docs/en/reference/agent-env/private-items.md).
- [Implementation and exports](src/index.ts), [input preparation](src/invoke-input.ts), [watchdog](src/watchdog.ts), [cleanup tests](../../test/executor-cleanup-budget.test.js).
