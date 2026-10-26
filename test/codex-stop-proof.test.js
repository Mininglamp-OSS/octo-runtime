import test from "node:test";
import assert from "node:assert/strict";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { CodexTurnStopEvidence } from "../packages/octo-runtime-adapter-codex/dist/turn-stop-evidence.js";
import { codexAppServerFixture, invokeRequest } from "./runtime-fixture.js";

for (const mode of ["ack-only", "real-terminal"]) {
  test(`Codex cancellation ${mode} separates proxy cleanup from actual turn stopping`, async () => {
    const fixture = codexAppServerFixture();
    const child = fixture.spawnFn();
    const originalWrite = child.stdin._write.bind(child.stdin);
    child.stdin._write = (chunk, encoding, callback) => {
      const message = JSON.parse(chunk.toString());
      originalWrite(chunk, encoding, callback);
      if (mode === "real-terminal" && message.method === "turn/interrupt")
        setTimeout(() => {
          child.stdout.write(
            JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: "thread-fixture",
                turnId: "turn-fixture",
                turn: { id: "turn-fixture", status: "interrupted" }
              }
            }) + "\n"
          );
        }, 5);
    };
    const adapter = createCodexAdapter({ spawnFn: fixture.spawnFn });
    const abort = new AbortController();
    const stopped = [],
      events = [];
    for await (const event of adapter.invoke(
      invokeRequest({ approvalMode: "full_access", signal: abort.signal }),
      { reportExecutionStopped: (state) => stopped.push(state) }
    )) {
      events.push(event);
      if (event.type === "session.update") abort.abort("model silence");
    }
    assert.equal(events.at(-1).type, "run.cancelled");
    assert(fixture.writes.some((message) => message.method === "turn/interrupt"));
    assert.deepEqual(stopped, mode === "real-terminal" ? ["cancelled"] : []);
    assert(
      child.exitCode !== null || child.signalCode !== null,
      "local proxy is closed in either case"
    );
  });
}

test("only matching thread and turn terminal evidence can confirm execution stopped", () => {
  const proof = new CodexTurnStopEvidence();
  proof.thread("thread");
  proof.turn("turn");
  const params = {
    threadId: "thread",
    turnId: "turn",
    turn: { id: "turn", status: "interrupted" }
  };
  assert.equal(proof.observe("turn/completed", { ...params, threadId: "other" }), undefined);
  assert.equal(proof.observe("turn/completed", { ...params, turnId: "other" }), undefined);
  assert.equal(proof.observe("turn/interrupt", params), undefined);
  assert.equal(
    proof.observe("turn/completed", { ...params, turn: { id: "turn", status: "running" } }),
    undefined
  );
  assert.equal(proof.observe("turn/completed", params), "cancelled");
  assert.equal(proof.observe("turn/completed", params), undefined);
});
