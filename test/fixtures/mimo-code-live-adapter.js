import { mimoCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mimo-code";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

// 真实模型验收只旁观 CanonicalEvent；不记录上下文、正文或凭据，不改写事件。
export const tracedMimoCodeAdapter = {
  ...mimoCodeAdapter,
  async *invoke(request, context) {
    const record = async (value) =>
      appendFile(
        join(request.workdir, "mimo-trace.jsonl"),
        `${JSON.stringify({ invocationId: request.invocationId, ...value })}\n`
      );
    await record({ type: "invoke" });
    try {
      for await (const event of mimoCodeAdapter.invoke(request, context)) {
        await record({
          type: event.type,
          ...(event.type === "session.update"
            ? { sessionId: event.payload.providerSession?.sessionId }
            : {})
        });
        yield event;
      }
    } catch (error) {
      await record({ type: "invoke.error" });
      throw error;
    }
  }
};
