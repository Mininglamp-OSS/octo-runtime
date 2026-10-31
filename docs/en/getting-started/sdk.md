# Your First SDK Invocation

[简体中文](../../zh-CN/getting-started/sdk.md) | [Documentation](../README.md)

This page shows how to call Kernel from a Node.js application. Use Node.js 24.x or 26.x (LTS) and install/authenticate your chosen Provider, such as Codex, on the execution machine.

Create a separate example directory and install the SDK there, or use your application's existing directory:

```sh
mkdir runtime-sdk-example
cd runtime-sdk-example
npm init --yes
npm install @mininglamp-oss/octo-runtime
```

Then either connect to an existing Kernel or create one in your application. Installing the npm package does not start services or install Provider CLIs.

Use a release matching this documentation's architecture. See [CLI installation](cli.md) for the current npm release status, source-build alternative, and Kernel startup commands, and [Harness setup](../guides/harnesses.md) for Provider installation and sign-in.

## Connect to an Existing Kernel

Kernel must already be running, for example through the foreground command in [CLI operations](cli.md). Use the same OS account. `attachKernel({ endpoint })` creates a client that connects when used; it does not start Kernel.

For a CLI-managed Kernel, obtain its address from the exact Runtime Home used to start it. Run this command from the example directory, replacing the path with that Home's absolute path:

```sh
node --input-type=module -e 'import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host"; console.log(componentEndpoint(process.argv[1]));' "/absolute/runtime-home"
```

This returns the socket path on macOS/Linux or the Named Pipe address on Windows. CLI `status --json` reports readiness, not the endpoint. For a Kernel created by an SDK host, use that host's configured endpoint rather than deriving one from a CLI Home.

Download [attach.mts](../../examples/attach.mts) and its helper [invoke.mts](../../examples/invoke.mts) into the example directory. Use the raw file contents from the same documentation revision. Both supported Node.js majors can run these `.mts` files directly without compiling TypeScript first. No Runtime source checkout or workspace build is required.

```sh
node attach.mts "<KERNEL_ENDPOINT>" codex
```

Replace `<KERNEL_ENDPOINT>` with the address obtained above, keeping it quoted. `codex` selects the Adapter for this invocation; it must be installed and authenticated on the Kernel's machine.

The example sends a greeting request, prints the Agent's final reply text, and waits for execution to finish. It cancels any interaction that requires a user reply; see [Output and Control](../reference/output-and-control.md) for application interaction handling. Connection or execution failures exit with an error. At the end, it closes the client connection while leaving Kernel running.

The invocation API itself is:

```ts
for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
  await consume(event);
}
```

Here, `client` is the connected Kernel client, `input` contains this invocation's parameters, and `consume` handles each event in your application. See [Inputs and Contexts](../concepts/inputs-and-contexts.md) for input structure and [invokeOnce](../../examples/invoke.mts) for complete error and final-status handling.

`invoke` returns an async iterator and submits the request when reading starts. Read until execution ends. Using `break` only stops receiving output; it does not cancel execution.

## Create Kernel in Your Application

To start the service from your application, use `createKernelService(options)` with at least:

- `endpoint`: the socket path or Named Pipe address to listen on.
- `workerEntrypoint`: the absolute path to the worker's JavaScript entry file.

Optionally set `stateDirectory` to store service state. A long-lived application normally initializes once and closes the service on exit. The following complete example selects DSH through its public Adapter export; other applications choose their own Adapters.

In the same example directory, download [dsh-worker.mts](../../examples/dsh-worker.mts), [dsh-service.mts](../../examples/dsh-service.mts), [dsh-invoke.mts](../../examples/dsh-invoke.mts), and [invoke.mts](../../examples/invoke.mts). The worker registers the actual Adapter:

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";
serveWorker([dshAdapter]);
```

Install and authenticate a DSH Provider at `0.2.1-rc.4` or later as described in [Harness Setup](../guides/harnesses.md). Have the host set `DSH_BIN` to the absolute JavaScript CLI entry of that installation, such as its `lib/bin.js`; a shell wrapper, `dsh.cmd`, Desktop executable or relative path is not this entry. This variable is read by the example host, not discovered by the Adapter. The host passes the value through `adapterConfigurations.dsh.providerOptions.dshBin` for discovery and invocation.

Compile the worker into JavaScript before passing it to Kernel:

```sh
npm install --save-dev typescript @types/node@24
npx tsc dsh-worker.mts --module nodenext --target es2023 --strict --types node --outDir build
node dsh-invoke.mts build/dsh-worker.mjs
```

The last command requires `DSH_BIN` in the host environment. It creates a Kernel in the calling process with a separate execution worker, prints canonical events, waits for the invocation's terminal event, and closes its own Kernel. A successful run includes `run.completed`; errors and incomplete cleanup fail the example. Ctrl+C requests cancellation and still checks cleanup. It uses a new temporary directory, without changing an existing Runtime Home.

DSH requires explicit `full_access`, which permits tools without individual approvals. The example supplies this setting; choose this Provider only when that permission matches your application. It also cancels any requested interaction. This example's Provider installation and real model access are separate prerequisites; see [DSH compatibility](../../../packages/octo-runtime-adapter-dsh/README.md) for Electron and upstream limitations.

SDK integration uses native imports without a manifest or an external Node service launcher. The bundled Runtime CLI owns its separate worker and manifest mechanism; see [Adapter and Extra Loading](../concepts/module-loading.md).

After creating the service, await `initialize()` before using `kernel.client`. On exit, close the application's Extras and wait for result consumption, delivery, and storage operations to finish before closing its Kernel and database. Check the cleanup result's `complete` field. If it is `false`, handle the reported pending resources.

The reusable [service.mts](../../examples/service.mts) and [invoke.mts](../../examples/invoke.mts) show service ownership, final-status handling and cancellation via `AbortSignal`. `run.failed`, `run.cancelled` and a stream without a terminal event are failures. Closing an attached client only closes observation; use the invocation's cancellation controls when execution must stop. For optional integrations, continue with [Extras](../guides/extras.md).

## Embed the Source as a Submodule

An application may consume the internal workspace packages instead of the published package. Add the submodule from the latest remote `main`:

```sh
git submodule add --branch main git@github.com:Mininglamp-OSS/octo-runtime.git octo-runtime
```

To initialize an existing submodule and actively upgrade it, first finish or preserve any local changes, then run:

```sh
git submodule update --init -- octo-runtime
git submodule set-branch --branch main -- octo-runtime
git submodule update --remote --checkout -- octo-runtime
git -C octo-runtime log -1 --oneline
```

A detached HEAD after the update is normal. `.gitmodules` tracks the branch used for upgrades; the application's Git commit pins the actual Runtime commit. Validate an upgrade before committing that pointer and the application's lockfile together. CI initializes the pinned submodule and uses `pnpm install --frozen-lockfile`; it does not update to remote `main` on every build.

Add this pattern to the application's `pnpm-workspace.yaml`, preserving its existing packages and required `allowBuilds` settings:

```yaml
packages:
  - octo-runtime/packages/*
```

Declare only packages directly imported by the application. For an application with Codex and Channel Gateway, merge these dependencies into its `package.json`:

```json
{
  "dependencies": {
    "@mininglamp-oss/octo-runtime-host-sdk": "workspace:*",
    "@mininglamp-oss/octo-runtime-executor-kernel": "workspace:*",
    "@mininglamp-oss/octo-runtime-adapter-codex": "workspace:*",
    "@mininglamp-oss/octo-runtime-extra-channel-gateway": "workspace:*"
  }
}
```

Run installation and dependency-ordered builds from the application root:

```sh
pnpm install
pnpm --filter @mininglamp-oss/octo-runtime-host-sdk... --filter @mininglamp-oss/octo-runtime-adapter-codex... --filter @mininglamp-oss/octo-runtime-extra-channel-gateway... run build
```

Compile the application's own worker and service entry files as part of its existing build. Rebuild the selected Runtime packages after changing their source. Keep the submodule's workspace configuration and lockfile; this integration uses the application's workspace and lockfile. The Runtime root CLI package and `apps/*` need not be included.

Source imports use internal package names: `createKernelService` and `serveWorker` come from `@mininglamp-oss/octo-runtime-executor-kernel`; `createExtraService` comes from `@mininglamp-oss/octo-runtime-host-sdk`; Extra plugin types come from its `/extra` subpath. Import the selected Adapter and Extra from their own packages. The invocation and shutdown order shown above also applies to source integration. See [workspace boundaries](../../../.octospec/guides/workspace.md) and the [Channel Gateway integration guide](../../../SDK_CHANNEL_GATEWAY_GUIDE.md) for further assembly details.

## Verify Without a Real Provider

From the repository root:

```sh
pnpm build
pnpm docs:check
```

`docs:check` checks example types, documentation links, and JSON, then runs a local Kernel invocation with a test Adapter. That Adapter returns fixed output, so no real Provider installation or login is needed. See [Maintenance and Validation](../maintenance.md) for the complete scope.

Next: [Inputs and Contexts](../concepts/inputs-and-contexts.md), [Output and Control](../reference/output-and-control.md).
