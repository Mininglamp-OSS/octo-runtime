import assert from "node:assert/strict";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

// 调用者提供与 live 共用的真实装配结果；本检查不 invoke，且只在确认清理后发布启动回执。
export async function reportVerificationStartup(host, scriptUrl, expectedAdapters) {
  let adapters;
  try {
    adapters = host
      .list()
      .map((adapter) => adapter.type)
      .sort();
    assert.deepEqual(adapters, [...expectedAdapters].sort());
  } finally {
    const result = await host.shutdown();
    assert.equal(result.state, "closed");
    assert.equal(result.cleanup, "complete");
    assert.deepEqual(result.unresolvedInvocationIds, []);
    assert.deepEqual(result.failedCleanupInvocationIds, []);
  }
  const receipt = {
    check: "startup",
    script: basename(fileURLToPath(scriptUrl)),
    adapters,
    cleanup: "complete"
  };
  await new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(receipt)}\n`, (error) =>
      error ? reject(error) : resolve()
    );
  });
}
