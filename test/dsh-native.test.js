import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";
import { resolveDshLaunch } from "../packages/octo-runtime-adapter-dsh/dist/launch.js";
import { kernelFixture } from "./kernel-fixture.js";

// 显式选择真实 npm 安装；仅握手，不创建会话、不发模型请求、不读取或修改用户认证。
test(
  "native npm DSH probes and initializes through the unmodified official SDK",
  {
    skip: !process.env.OCTO_DSH_NATIVE_BIN
  },
  async (t) => {
    const providerOptions = { dshBin: process.env.OCTO_DSH_NATIVE_BIN };
    const { client: kernelClient, directory } = await kernelFixture(t, {
      workerEntrypoint: fileURLToPath(new URL("./fixtures/dsh-worker.mjs", import.meta.url)),
      manifest: undefined,
      adapterConfigurations: { dsh: { providerOptions } }
    });
    const discovered = (await kernelClient.list()).find((entry) => entry.type === "dsh");
    assert.equal(discovered.available, true, JSON.stringify(discovered));
    const require = createRequire(
      new URL("../packages/octo-runtime-adapter-dsh/package.json", import.meta.url)
    );
    const { HarnessClient } = await import(
      pathToFileURL(require.resolve("@deepseek-ai/dsh-sdk-client"))
    );
    let client;
    try {
      const probe = await dshAdapter.probe({ providerOptions });
      assert.equal(probe.available, true, JSON.stringify(probe));
      const launch = await resolveDshLaunch(providerOptions, { ...process.env });
      client = new HarnessClient({
        dshBin: launch.dshBin,
        profile: "sdk",
        processCwd: directory,
        dshHome: directory,
        env: launch.env,
        initializeTimeoutMs: 15000
      });
      const result = await client.initialize({
        cwd: directory,
        provider: "deepseek-account",
        model: "deepseek-flash"
      });
      assert.deepEqual(result.serverInfo, {
        name: "deepseek-harness-sdk-runtime",
        version: "0.0.1"
      });
    } finally {
      await client?.close();
    }
  }
);
