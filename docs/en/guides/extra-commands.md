# Extra-owned commands

[简体中文](../../zh-CN/guides/extra-commands.md) | [Documentation](../README.md)

Use `octo-runtime <extra> --help` to discover setup commands. Root help reads the selected Extra catalog without importing Extras. Detailed help imports only the selected command module; it does not run handlers, authenticate, start services, or require a Kernel. Native SDK composition does not load command modules. The catalog combines built-in manifests, the Home manifest, and packages discovered in the current CLI’s global npm/pnpm environment, in that priority order. An explicit `--manifest` replaces all three sources.

## Configure the built-in Extras

`--home` and `--manifest` remain global Runtime options and work before or after the custom command, including alongside business options. The CLI selects the Home and module source before loading the command. `--json`, `-h` and `--help` also work in either position. Repeating an option is an error. After `--`, tokens are literal positional arguments, not global options. Configuration is Home-scoped; `--profile` is rejected. Host boolean flags retain the legacy presence semantics, including `--json=true` and `--help=true`; the equals value does not disable the flag. Extra-owned boolean options accept only the bare flag. Existing lifecycle syntax remains supported. The WeCom namespace is `channel-wecom`.

```sh
# 凭据文件由使用者在仓库外准备；stdin 传入凭据原文，不是 JSON。
octo-runtime --home /absolute/runtime channel-gateway configure \
  --api-url https://im.example.com/api --bot-id assistant \
  --adapter codex --workdir /absolute/workspace \
  --credential-stdin < /secure/bot-credential

octo-runtime --home /absolute/runtime channel-wecom configure \
  --bot-id assistant --adapter codex --workdir /absolute/workspace \
  --credential-stdin < /secure/wecom-credential

octo-runtime webui configure --home /absolute/runtime \
  --session-store-path /absolute/runtime/extras/webui/sessions.json \
  --port 13888 --project-path /absolute/workspace
```

Prepare credential files outside the repository. `--credential-stdin` reads the raw credential, not JSON; it never accepts credentials in argv. Bot commands also expose `--model`, `--effort` and `--provider-agent-id`. OpenClaw uses its existing Agent workspace and rejects `--workdir`; local adapters reject `--provider-agent-id`. WeCom requires a local workdir unless using OpenClaw and accepts an optional `--ws-url`. Gateway keeps its existing default workdir behavior. WebUI also accepts `--project-path`.

Gateway deduplicates by its existing normalized API URL + bot_id identity; WeCom uses normalized WS URL + bot_id. `configure` updates a matching Bot and appends a new identity, preserving omitted fields and other Bots. A changed endpoint creates a new identity; remove obsolete entries through full JSON replacement. WebUI has one `webui` configuration per Home; changing its port updates the same instance.

Commands construct the same envelope used by `extraset` and save `<home>/extras/<name>/config.json`, preserving host-owned `enabled` and `module`. They work before setup and while disabled. Saving does not start, enable or reload services. `saved: true` and `reload_required: true` mean persistence succeeded; restart the whole Extra to apply changes. For first use, run `<extra> start`. Agent tasks separately require executor-kernel.

```sh
octo-runtime --home /absolute/runtime channel-gateway config set < gateway-business.json
octo-runtime --home /absolute/runtime channel-gateway config get
octo-runtime channel-gateway restart --home /absolute/runtime
```

`config set` reads business JSON, for example `{"bots":[]}`, without the extraset envelope. It validates and replaces the complete business configuration; duplicate Bot identities are rejected. **`config get` returns credentials** and must only write to a trusted destination; an unconfigured Extra returns `{}`. Legacy `extraset`/`extraget` retain the full-envelope interface and generic validation. Saving, help and validation errors do not echo credentials.

Configuration is read before interaction. Saving takes the same Home lock as extraset and compares the entire stored declaration with the snapshot revision. Concurrent changes fail with `EXTRA_CONFIG_CONFLICT`; read again before deciding to retry. Cancellation before the atomic write prevents saving; once writing starts, the actual write result wins. Completed saves are not rolled back. POSIX files remain 0600, and corrupt or unsafe files are not treated as missing configuration.

## Author a command extension

Export an independent `./commands` module from the selected Extra package. Import public types from `@mininglamp-oss/octo-runtime/extra`. Modules must have no initialization side effects.

```ts
import type { ExtraCommandExtension } from "@mininglamp-oss/octo-runtime/extra";

// CLI 拥有 signal 和持久化；Extra 负责业务校验，交互必须配合取消。
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [{
    name: "configure",
    description: "Save the business endpoint",
    options: [{ name: "endpoint", type: "string", required: true, description: "Service URL" }],
    async run(ctx, input) {
      const snapshot = await ctx.readConfig();
      const endpoint = String(input.options.endpoint);
      // 这里按业务合同校验 endpoint；若需认证，在写锁外完成并传 ctx.signal。
      const saved = await ctx.saveConfig({ ...snapshot.config, endpoint }, snapshot.revision);
      return { value: { ...saved } };
    }
  }]
};
export default extension;
```

Packages named `octo-runtime-extra-<name>` or `@scope/octo-runtime-extra-<name>` installed in the same global environment as the CLI are discovered automatically. Their `/commands` export uses the same selected installation as the service; removal or replacement invalidates that selection. See [module loading](../concepts/module-loading.md). For other names or local installations, select the package through the Home manifest:

```json
{"version":1,"adapters":[],"extras":[{"name":"loop-daemon","module":"your-extra-package"}]}
```

The package must resolve from that manifest, for example from its adjacent `node_modules`. Service and command resolution use the same selected module and source manifest, never an unrelated globally installed package. For file modules, declare `"commands":"./commands.mjs"` in the same entry. Ignored duplicate entries are never imported. Missing optional exports preserve lifecycle functionality; broken declared exports and unsupported API versions fail only the selected command extension.

Use `commands` for nested groups and `run` for leaves, exclusively. Maximum depth is 8 below the top-level group, with at most 128 commands. Groups cannot declare options or positional arguments. Options are string or boolean; string values accept `--name value` and `--name=value`. Use the equals form for values beginning with `-`. Positional `arguments` are consumed in declaration order; after `--`, every token is positional, including host flags and help. Unknown or duplicate options and excess arguments fail. Required-value checks are skipped for help.

Runtime root namespaces, lifecycle command names (`install`, `uninstall`, `start`, `stop`, `restart`, `status`, `run`, `logs`) and host option names are reserved. `run` receives parsed input and a context with Home, cancellation, configuration snapshots, atomic saves, output, interactive prompts and bounded stdin (1 MiB). `prompt` is for non-secret terminal input; use `readStdin` for credentials. The handler returns optional JSON `value`, a safe human-readable `message`, and `exitCode` (0..255, default 0). Avoid extra stdout output when producing machine-readable results.

Only use `ExtraCommandError` for fixed, safe diagnostics; do not include credentials, raw input or backend errors. Other handler failures become `EXTRA_COMMAND_FAILED`. Extensions own output redaction, cooperative cancellation and cleanup of their resources. They run in the CLI process, not a JavaScript sandbox. Completed remote effects and saved configuration are not automatically rolled back.
