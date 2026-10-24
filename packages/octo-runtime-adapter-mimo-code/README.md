# @mininglamp-oss/octo-runtime-adapter-mimo-code

[简体中文](README.zh-CN.md)

Xiaomi MiMo Code adapter, type `mimo-code`. Each invocation starts `mimo acp` and uses the same shared ACP adapter as Kimi Code for sessions, model selection, canonical streaming, permissions, cancellation, and cleanup. There is no MiMo-specific Gateway path.

## Configuration Names

| Location                                                     | Value                          |
| ------------------------------------------------------------ | ------------------------------ |
| Public SDK/CLI Context `octo.execution/adapter.payload.type` | `mimo-code`                    |
| Channel Gateway `bots[].adapter.adapter_type`                | `mimo-code`                    |
| Executable and launch command                                | `mimo`, launched as `mimo acp` |

`mimoi` is not a registered adapter type or alias. The adapter type is separate from the MiMo model ID.

## Prerequisites

Install MiMo Code yourself using the [official setup](https://github.com/XiaomiMiMo/MiMo-Code#quick-start), make `mimo` available on the worker's `PATH`, and run `mimo` under that OS account to configure a provider and authentication. Runtime does not install MiMo, inspect credentials, or change its configuration. An executable probe does not verify authentication or model access.

The tested release is [v0.1.15](https://github.com/XiaomiMiMo/MiMo-Code/releases/tag/v0.1.15), whose [ACP entry](https://github.com/XiaomiMiMo/MiMo-Code/blob/v0.1.15/packages/opencode/src/cli/cmd/acp.ts) exposes the `acp` subcommand, ACP SDK NDJSON stdio, and an internal HTTP service.

**Known upstream ACP limitation in MiMo Code 0.1.15:** MiMo can return the `session/prompt` response with `stopReason: "end_turn"` before sending the remaining `agent_message_chunk` notifications for the same prompt. Runtime can therefore emit `run.completed` with only a prefix of the answer. The adapter does not detect or convert this ordering violation into `run.failed`. Do not use MiMo 0.1.15 where complete output is required. The issue is tracked in [XiaomiMiMo/MiMo-Code#2709](https://github.com/XiaomiMiMo/MiMo-Code/issues/2709), with a standalone reproduction and ACP lifecycle references.

The Runtime integration and MiMo release compatibility have separate acceptance criteria. This adapter provides standard ACP wiring, CLI registration and packaging with automated regression coverage. Its inclusion does not certify the installed MiMo release. No MiMo Code release has passed final end-to-end acceptance for this adapter yet. After an upstream fix, record the specific fixed build and rerun SDK, CLI and visible Gateway exact-output acceptance before production qualification. A successful executable probe or an upstream issue closure alone is insufficient.

On macOS arm64 on 2026-10-23, actual execution reported the user's existing default model as `deepseek/deepseek-flash`. This is the MiMo Code CLI provider, not necessarily a Xiaomi-hosted model endpoint. Credentials and provider configuration were not modified.

An installed executable may be outside the worker's PATH. For a macOS/Linux installation at `~/.mimocode/bin/mimo`, add that directory to the environment used to start the host, or use the factory command override below:

```sh
export PATH="$HOME/.mimocode/bin:$PATH"
mimo --version
mimo acp --help
```

Restart an existing host/service with the updated environment; a shell alias or an export in another terminal does not update a running process.

## SDK and CLI

In the SDK host's internal worker, import and register the adapter alongside your other selected adapters:

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { mimoCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mimo-code";

// The host owns the worker lifecycle; shared ACP owns each MiMo child process.
serveWorker([mimoCodeAdapter]);
```

The adapter package follows the repository's private workspace package convention and is bundled in the Runtime distribution. It is not separately published. SDK products select and deploy their own modules; see [module loading](../../docs/en/concepts/module-loading.md).

The CLI includes `mimo-code` in its default manifest. Start the Kernel and check detection:

```sh
octo-runtime executor-kernel start
octo-runtime adapter probe mimo-code
octo-runtime playboard < ./mimo-request.json
```

`playboard` uses a temporary Kernel. `mimo-request.json` uses the same public input for the SDK client's `invoke`:

```json
{
  "protocol_mode": "canonical",
  "inputs": [{ "type": "text", "text": "Reply with hello." }],
  "contexts": {
    "schema": "octo.context-envelope/v3",
    "items": [
      { "namespace": "octo.execution", "name": "adapter", "payload": { "type": "mimo-code" } }
    ]
  }
}
```

Gateway hosts set `bots[].adapter.adapter_type` to `mimo-code`. Within the existing Bot entry, the adapter fragment is:

```json
{
  "adapter": {
    "adapter_type": "mimo-code"
  }
}
```

Admission, context, interaction, and delivery remain the common channel implementation.

For an explicit executable path, register `createMimoCodeAdapter({ command: "/absolute/path/to/mimo" })` in your worker. CLI users can select that factory with `factory: true`, `export: "createMimoCodeAdapter"`, and `options: { "command": "/absolute/path/to/mimo" }` in an explicit replacement `--manifest`. A Home extension cannot override an existing built-in type.

## Execution and Verification Limits

Shared ACP forwards the invocation cwd, isolated environment, and MCP configuration; HTTP MCP and images require the provider's native advertisement. An explicit model must be advertised by the session and is selected with the shared ACP setter; it is never silently replaced. Continuation uses `session/load`, and unsupported provider operations return the real failure. Ordinary business Context remains ordered and is rendered each turn; execution settings are separate from model text.

Approval modes `ask` and `full_access` use the shared permission bridge. `assisted` is rejected. No native reasoning-effort setter is implemented; an explicit effort produces the common not-applied notice. Native output mode is unsupported; select `canonical`.

Fixture tests cover adapter selection, launch/cwd/isolated environment, streaming, model selection, continuation, provider errors, cancellation and reuse. Run `node scripts/verify-mimo-code.mjs` after building to check actual SDK and CLI execution; on 0.1.15 the exact-text assertion exposes the upstream truncation. A timed tail-drain experiment was rejected during review because silence cannot prove completeness; the final adapter uses the standard ACP completion boundary without that workaround.

Experimental SDK/CLI and online Gateway runs demonstrated model execution, continuation, tools, cancellation and group replies, but do not qualify the final implementation. With the final adapter, real SDK execution and human-browser Gateway SDK replies were observed, but exact-output checks failed because of the upstream truncation. The Gateway CLI browser probe timed out; its cause was not established. MiMo release compatibility remains unqualified while the Runtime integration is reviewed with this known limitation. MCP/images and interactive approval remain unverified. See the [acceptance journal](../../.octospec/journal/shared/2026-10-23-16-mimo-code.md) for evidence and remaining checks. Linux and Windows 10/11 real-provider cases remain unexecuted; Windows is tracked by [#14](https://github.com/Mininglamp-OSS/octo-runtime/issues/14).

For missing executables, check the service's PATH or factory command. For authentication/model errors, verify MiMo directly with the same account and cwd. Unsupported ACP methods or model IDs require a compatible MiMo version/configuration; Runtime returns the error without switching providers. Shared process ownership applies, including the documented Windows parent-first cleanup limits.
