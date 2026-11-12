# AgentEnv Standard Reference

[简体中文](../../zh-CN/reference/agent-env-standard.md) | [Documentation](../README.md)

## AgentEnv

### Example

```json
{
  "schema": "octo.context-envelope/v3",
  "items": []
}
```

### Payload

| Field | Definition |
| --- | --- |
| `schema` | Required constant `octo.context-envelope/v3` |
| `items` | Required ordered array, 0–32 items |
| `items[].namespace` | Required string, 1–96 characters, matching `^[a-z0-9][a-z0-9._-]*$` |
| `items[].name` | Required string, same rules as namespace |
| `items[].payload` | Required JSON object, not an array or null; see each item below |

### Notes

One AgentEnv can contain the seven public item types below and Adapter-private items; all seven are not required. namespace/name pairs must be unique. Envelope and item reject unknown top-level fields. The whole envelope is limited to 65,536 UTF-8 bytes and JSON depth 32, without undefined, functions, non-finite numbers or invalid Unicode.

Empty items pass structural validation without establishing a workdir, registered Adapter or authentication. The client snapshots at invocation and submits on first consumption; Core forwards in order and the Adapter consumes and validates payloads. Settings do not automatically enter model text.

Text, images, prompts and history belong in [inputs](input-parts.md); Adapter-specific payloads are described in [Private Items](agent-env/private-items.md). modeId is a work-mode ID, not a model ID; model IDs use octo.execution/model.payload.selection.id.

## `octo.execution/adapter`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "adapter",
  "payload": {
    "type": "codex"
  }
}
```

### Payload

| Field  | Definition                                                         |
| ------ | ------------------------------------------------------------------ |
| `type` | Required non-empty string matching a host-registered Adapter type. |

### Notes

Selects an already registered execution implementation. A public standard item; it does not select a device, account or Provider Agent, or install a Provider.

**Omission and Execution Boundary**

When omitted, the current execution entrypoint selects `codex`; the host must still register it. Declaring a type does not load modules, construct an Engine or discover an executable. The host prepares those dependencies before invocation.

Only `type` is allowed in the payload. Use the Adapter's [private configuration](agent-env/private-items.md) for Provider targets. Changing type does not migrate an existing Provider session.

## `octo.execution/workspace`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "workspace",
  "payload": {
    "path": "/absolute/prepared/project"
  }
}
```

### Payload

| Field  | Definition                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------- |
| `path` | Required non-empty string; local execution requires an existing, accessible absolute directory. |

### Notes

Specifies a caller-prepared local working directory. A public standard item; the caller owns the directory, and a working directory is not an OS sandbox.

**Preparation and Omission**

The caller creates or selects the directory before invoking Runtime. Runtime does not default to cwd, create directories, recover paths from sessions or recreate paths for fresh fallback. An Adapter declaring `metadata.workspace: false` can omit a local override; OpenClaw uses a Provider-owned workspace.

**Validation and Failure**

| Reason Code             | Condition                                   |
| ----------------------- | ------------------------------------------- |
| `WORKDIR_REQUIRED`      | Missing path                                |
| `WORKDIR_INVALID`       | Relative path, NUL or invalid shape         |
| `WORKDIR_NOT_FOUND`     | Path does not exist                         |
| `WORKDIR_NOT_DIRECTORY` | Path is not a directory                     |
| `WORKDIR_UNAVAILABLE`   | Access denied or another filesystem failure |

These retain public category `OH-ADP-3004`. Validation cannot eliminate later filesystem races. The payload contains only `path`. Runtime Home, Provider Home, logs and application directories have separate owners.

## `octo.execution/model`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "model",
  "payload": {
    "selection": {
      "id": "provider-model-id"
    },
    "reasoning": {
      "effort": "high"
    }
  }
}
```

### Payload

| Field       | Definition                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `selection` | Optional object containing only a required non-empty string `id`.                                             |
| `reasoning` | Optional object containing only required string `effort`; execution accepts `low`, `medium`, `high`, `xhigh`. |

### Notes

Provides this invocation's model selection and reasoning effort. A public standard item; model identifiers belong to the actual Provider/backend. Runtime has no unified model catalog.

**Omission and Support**

Provide at least one of selection or reasoning. Omit selection to send no explicit model, and reasoning to send no explicit effort. Omit the entire item when neither is selected. Empty objects, empty id/effort are invalid omission forms. On resumed native sessions, omission does not guarantee a reset of earlier choices.

The Adapter maps native parameters and performs Provider-required model confirmation. Effort fallback emits `REASONING_EFFORT_DOWNGRADED`; a channel without a setter uses the native default and emits `REASONING_EFFORT_NOT_APPLIED` under the existing contract. It does not add reasoning instructions to the prompt. Unsupported models, account permissions and connectivity are separate failures. See [Providers](providers.md) and Adapter READMEs for mappings.


## `octo.execution/envs`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "envs",
  "payload": {
    "env_variables": [
      {
        "key": "PROJECT_ID",
        "value": "project-123"
      },
      {
        "key": "API_BASE_URL",
        "value": "https://api.example.com"
      }
    ]
  }
}
```

### Payload

| Field                   | Definition                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `env_variables`         | Required list of 0–128 entries, each containing only required `key` and `value`.     |
| `env_variables[].key`   | String matching `^[A-Za-z_][A-Za-z0-9_]*$`; exact duplicate keys are rejected.       |
| `env_variables[].value` | String without NUL. Empty strings are valid; null, numbers and booleans are invalid. |

### Notes

Supplies per-invocation environment overrides. A public standard item for Adapters that consume local execution environments; it is neither model text nor a remote-machine environment management API.

**Scope and Precedence**

Omission or an empty list adds no overrides at that layer. It does not delete inherited process-environment values; no variable deletion operation exists. Values remain literal: no `${NAME}` expansion, `.env` loading or shell evaluation.

Execution combines the host-supplied base environment, invocation envs, trusted host overrides and fixed Adapter transport settings in that order. Later layers win. Each invocation gets a separate object without changing global `process.env`. Final environment keys are case-insensitive on Windows and case-sensitive elsewhere. A host-bound base environment does not change when another terminal later exports a variable.

**Provider Boundary**

A persistent Codex app-server is not restarted for different envs; invocation shell/MCP settings travel through thread/turn configuration. envs does not replace the host-bound executable, account or CODEX_HOME. OpenClaw rejects non-empty invocation envs with CONTEXT_ENVS_UNSUPPORTED rather than injecting remote environments.

**Composition and Sensitive Values**

The complete envelope has a 65,536-byte budget. Do not copy variable values into inputs, public events or logs. Authorized tool processes can read their execution environment.

## `octo.execution/mcp`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "mcp",
  "payload": {
    "mcpServers": {
      "project-tools": {
        "type": "stdio",
        "command": "/absolute/bin/project-mcp",
        "args": ["--project", "${PROJECT_ID}"]
      },
      "project-docs": {
        "type": "streamable_http",
        "url": "https://example.com/mcp",
        "headers": {
          "X-Project-ID": "${PROJECT_ID}"
        }
      }
    }
  }
}
```

### Payload

The payload contains only required `mcpServers`, a dynamic name map with at most 32 servers. Names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Omission or an empty map adds no invocation connections; it does not clear native Provider MCP configuration.

**stdio**

| Field              | Definition                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `type`             | Required constant `stdio`                                                                    |
| `command`          | Required non-empty string; the Provider launches the prepared program                        |
| `args`             | Optional string array, at most 128 entries                                                   |
| `env`              | Optional string map, at most 128 entries; names follow envs rules, values cannot contain NUL |
| `cwd`              | Optional non-empty string, subject to Adapter support                                        |
| `required`         | Optional boolean, subject to native support; not a default fail-open declaration             |
| `startupTimeoutMs` | Optional integer, 100–300,000 milliseconds                                                   |
| `toolTimeoutMs`    | Optional integer, 100–3,600,000 milliseconds                                                 |

stdio env overrides matching variables for that MCP child, without modifying the whole Provider or other servers.

**Streamable HTTP**

| Field                                           | Definition                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                                          | Required constant `streamable_http`                                                                                                         |
| `url`                                           | Required string, at most 4096 characters; after expansion, an absolute HTTP(S) URL without user information, fragment or control characters |
| `headers`                                       | Optional string map, at most 64 entries; valid HTTP names, unique ignoring case; values cannot contain CR, LF or NUL                        |
| `required`, `startupTimeoutMs`, `toolTimeoutMs` | Same types and ranges as above; subject to Adapter support                                                                                  |

Both variants reject unknown fields, mixed transport fields and unknown types. HTTP rejects command/env; stdio rejects url/headers.

### Notes

The standard name is `octo.execution/mcp`, not `mcps`. This public execution configuration describes invocation-scoped MCP connections. It is not the MCP wire protocol, an installer or a private Adapter item. The caller prepares stdio programs or HTTP services before submission.

PROJECT_ID must exist in the execution environment; it can be supplied using envs. The host injects credentials from outside the repository.

**Template Expansion**

On the execution host, the Adapter SDK expands `${NAME}` once in command, args, cwd, env values, url and header values using the invocation environment. Names and keys are not expanded. Replacement results are not scanned again. envs values remain literal.

`$${NAME}` produces literal `${NAME}`. Claude Code rejects final values containing `${` with `MCP_LITERAL_UNSUPPORTED` because its native loader expands again. Missing variables produce `MCP_ENV_MISSING` with the location and variable name only. URL, command and headers are validated after expansion. The original envelope and user configuration files are not rewritten.

**Adapter Mapping and Failures**

| Adapter              | Native Carrier and Extra Options                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Codex                | thread/start and thread/resume config.mcp_servers; supports cwd/required/both timeouts             |
| Claude Code          | Private temporary --mcp-config, HTTP maps to http; none of those four extra options                |
| ACP                  | session/new and session/load mcpServers arrays; checks native HTTP support; no extra options above |
| OpenCode             | V2 CLI environment configuration or ACP for ask; V2 supports toolTimeoutMs                         |
| Adapters without MCP | Non-empty configuration fails with MCP_UNSUPPORTED                                                 |

Unrepresentable optional fields produce `MCP_OPTION_UNSUPPORTED`. Codex rejects names colliding with native configuration, including disabled entries, with `MCP_SERVER_NAME_CONFLICT`; it does not overwrite or rename them. Other native-loader precedence rules belong in Adapter READMEs. An empty map does not imply native-tool isolation.

Connection, discovery, actual tool invocation and business authorization are separate facts. Configuration does not change the approval policy.

Grok Build uses shared ACP mapping and rejects final configuration values containing `${` with `MCP_LITERAL_UNSUPPORTED`, avoiding native re-expansion.

## `octo.execution/limits`

### Example

```json
{
  "namespace": "octo.execution",
  "name": "limits",
  "payload": {
    "run_timeout_ms": 86400000,
    "model_idle_policy": "observe"
  }
}
```

### Payload

| Field                    | Range             | Default        | Meaning                                                           |
| ------------------------ | ----------------- | -------------- | ----------------------------------------------------------------- |
| `first_frame_timeout_ms` | 100–1,800,000     | 60,000         | Budget for initial valid execution progress                       |
| `model_idle_timeout_ms`  | 100–3,600,000     | 300,000        | No-progress budget in the active model phase                      |
| `model_idle_warning_ms`  | 100–3,600,000     | 120,000        | Model idle warning threshold                                      |
| `model_idle_policy`      | enforce / observe | enforce        | enforce cancels on idle timeout; observe only observes model idle |
| `tool_timeout_ms`        | 100–86,400,000    | 600,000        | Per-tool no-progress budget                                       |
| `tool_wall_timeout_ms`   | 100–86,400,000    | 未设置 / unset | Per-tool total elapsed budget from tool start                     |
| `run_timeout_ms`         | 100–604,800,000   | 86,400,000     | Whole invocation budget, default 24 hours, maximum 7 days         |
| `cancel_grace_ms`        | 100–60,000        | 1,000          | Grace budget after cancellation                                   |

### Notes

A public standard item configuring the invocation watchdog. Numeric fields are integer milliseconds with inclusive bounds. All fields are optional; execution uses the defaults below.

**Timing and Failure Boundary**

The Adapter maps the snake_case payload to local RuntimeLimits. Core executes the watchdog through a local callback without parsing the AgentEnv limits item. Omitting the item or supplying an empty payload uses defaults without adding fields to the original envelope.

Whole-invocation, first-progress, model-idle, tool-idle and tool-wall budgets are separate. Tool progress can refresh idle time but cannot extend its wall budget. Model and approval-wait phases have distinct states; logs or transport heartbeats do not count as model progress. Raising run_timeout_ms does not extend other budgets. observe disables only model-idle termination; other budgets remain effective.

Timeout requests cancellation; it does not prove Provider or descendant cleanup. Continue observing the original terminal and cleanup result. Zero, null and Infinity do not request unlimited execution. The 60-second public model-text silence notice is a separate output observer, unaffected by model_idle_warning_ms; see [Output and Control](output-and-control.md).

## `octo.security/approval_policy`

### Example

```json
{
  "namespace": "octo.security",
  "name": "approval_policy",
  "payload": {
    "mode": "ask"
  }
}
```

### Payload

| Field  | Definition                                       |
| ------ | ------------------------------------------------ |
| `mode` | Required enum: `ask`, `assisted`, `full_access`. |

### Notes

Selects the tool approval policy. A public standard item; business-resource authorization is separate from tool approval.

**Omission and Native Mapping**

The SDK helper defaults to `ask`; the CLI host may explicitly choose its own default. `ask` retains the human approval path, `assisted` uses the Adapter's restricted assisted policy, and `full_access` relaxes tool approval on supported native paths. Native permissions vary; these names do not imply a uniform OS sandbox guarantee. See [Providers](providers.md) and the chosen Adapter README for mappings.

**Interaction Boundary**

The caller consumes approval requests and answers using the original invocation and interaction identities. `full_access` does not answer questions, information requests or asynchronous questions, and does not establish business API permissions. Approval ACK, execution terminal state and completed resource cleanup are separate facts. See [Output and Control](output-and-control.md) for the round-trip API.

Only mode is allowed in this payload; unknown fields and values are rejected at consumption.

Channels without assisted support, including shared ACP, OpenCode and OpenClaw, return APPROVAL_MODE_UNSUPPORTED. Antigravity and DSH require explicit full_access. A public enum does not imply all values are supported by every Adapter.

## Helper APIs

See the supplementary [AgentEnv Helper APIs](agent-env/helpers.md) for constructing, reading and merging AgentEnv.
