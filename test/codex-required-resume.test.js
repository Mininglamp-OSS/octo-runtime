import test from "node:test";
import assert from "node:assert/strict";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { codexAppServerFixture, invokeRequest } from "./runtime-fixture.js";

async function collect(fixture, provider = {}) {
  const adapter = createCodexAdapter({ spawnFn: fixture.spawnFn });
  const events = [];
  for await (const event of adapter.invoke(
    invokeRequest({
      approvalMode: "full_access",
      providerSession: {
        sessionId: "thread-fixture",
        resumable: true,
        codexRequireResume: true,
        ...provider
      },
      modelInput: "continue the unfinished task",
      signal: AbortSignal.timeout(2000)
    })
  )) {
    events.push(event);
    if (event.type === "session.update") fixture.complete();
  }
  return events;
}
for (const [mode, options, turns] of [
  ["resume missing", { threadResumeError: "no rollout found for thread" }, 0],
  ["turn missing", { turnStartError: "no rollout found for thread" }, 1],
  ["different thread", { resumedThreadId: "other-thread" }, 0]
]) {
  test(`required Codex resume rejects ${mode} without creating an empty fallback thread`, async () => {
    const fixture = codexAppServerFixture(options);
    const events = await collect(fixture);
    assert.equal(events.at(-1).type, "run.failed");
    assert.equal(fixture.writes.filter((message) => message.method === "thread/start").length, 0);
    assert.equal(fixture.writes.filter((message) => message.method === "turn/start").length, turns);
    assert.equal(events.filter((event) => event.type === "session.update").length, 0);
  });
}
test("required Codex resume succeeds on the same thread", async () => {
  const fixture = codexAppServerFixture();
  const events = await collect(fixture);
  assert.equal(events.at(-1).type, "run.completed");
  const session = events.find((event) => event.type === "session.update").payload.providerSession;
  assert.equal(session.sessionId, "thread-fixture");
  assert.equal(session.resumeOutcome, "resumed");
  assert.equal(fixture.writes.filter((message) => message.method === "thread/start").length, 0);
});
test("ordinary Codex resume retains its existing fresh fallback", async () => {
  const fixture = codexAppServerFixture({ threadResumeError: "no rollout found for thread" });
  const events = await collect(fixture, { codexRequireResume: false });
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(
    events.find((event) => event.type === "session.update").payload.providerSession.resumeOutcome,
    "fresh_fallback"
  );
  assert.equal(fixture.writes.filter((message) => message.method === "thread/start").length, 1);
});
test("explicitly non-resumable required session starts no turn", async () => {
  const fixture = codexAppServerFixture();
  assert.equal((await collect(fixture, { resumable: false })).at(-1).type, "run.failed");
  assert.equal(fixture.writes.filter((message) => message.method === "turn/start").length, 0);
});
