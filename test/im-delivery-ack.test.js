import test from "node:test";
import assert from "node:assert/strict";
import { ImSendError } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/send-error.js";
import { ImDeliveryDispatcher } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js";
import { OctoApiError } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/errors.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";

test("dispatcher stops permanent rejection and preserves earlier REST uncertainty", async () => {
  const dispatcher = new ImDeliveryDispatcher(new AbortController().signal);
  let count = 0;
  const result = await dispatcher.deliver("text", async () => {
    count++;
    throw new ImSendError("IM_SEND_REJECTED_2", "failed");
  });
  assert.equal(count, 1);
  assert.equal(result.state, "failed");
  count = 0;
  const unknown = await dispatcher.deliver("card", async () => {
    if (++count === 1) throw Error("network");
    throw new OctoApiError({ status: 403, path: "/fixture", body: "denied", retryAfterMs: 0 });
  });
  assert.equal(unknown.state, "unknown");
  assert.equal(count, 2);
});

for (const terminal of ["run.completed", "run.cancelled"]) {
  test(`F27 ${terminal} is not rewritten or rerun after final retries; no fallback notice`, async (t) => {
    let receive,
      invokes = 0,
      notices = 0,
      sends = 0;
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = this.callbacks.onMessage;
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(
      {
        bot_id: "fixture",
        api_url: "https://im-test.deepminer.com.cn/api",
        adapter: { adapter_type: "codex" }
      },
      {
        kernel: {
          async *invoke() {
            invokes++;
            yield { protocolVersion: 2, type: terminal, payload: {} };
          },
          async cancelInvocation() {
            return { accepted: true };
          }
        }
      }
    );
    t.after(() => runtime.close());
    await runtime.start();
    receive({
      messageId: "m1",
      senderId: "owner",
      conversationId: "g",
      conversationKind: "group",
      text: "work",
      async buildContext() {
        return { schema: "octo.context-envelope/v3", items: [] };
      },
      async reply() {
        sends++;
        throw new ImSendError("IM_SEND_TIMEOUT", "unknown");
      },
      async replyFailure() {
        notices++;
      }
    });
    for (let i = 0; i < 100 && runtime.status.workingTasks; i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(invokes, 1);
    assert.equal(sends, 4);
    assert.equal(notices, 0);
    assert.equal(runtime.status.workingTasks, 0);
  });
}
