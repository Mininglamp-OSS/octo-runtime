import { randomUUID } from "node:crypto";
import type { KernelClient } from "@mininglamp-oss/octo-runtime/executor-kernel";
import type {
  InvokeInput,
  CanonicalEvent,
  InteractionRequestedPayload,
  InteractionResponse
} from "@mininglamp-oss/octo-runtime/protocol";
import { invokeOnce } from "./invoke.mts";
import { assertQuestionRequest } from "@mininglamp-oss/octo-runtime/protocol";

/** 用户界面决定回复；在原 client、原 invocation 下响应，并继续消费到终态。 */
export async function invokeInteractive(
  client: KernelClient,
  input: InvokeInput,
  ask: (request: InteractionRequestedPayload) => Promise<InteractionResponse>,
  consume: (event: CanonicalEvent) => void | Promise<void>
): Promise<void> {
  const invocationId = input.invocationId ?? randomUUID();
  await invokeOnce(client, { ...input, invocationId }, async (event) => {
    await consume(event);
    if (event.type === "interaction.requested") {
      const response = await ask(event.payload);
      await client.respondInteraction(invocationId, response);
    }
  });
}

/** UI 保存表单；调用方继续读流，不在读流回调中等待用户。 */
export function asyncQuestionForm(
  client: KernelClient,
  invocationId: string,
  event: CanonicalEvent
) {
  if (event.type !== "interaction.requested" || event.payload.delivery !== "async") return;
  const request = event.payload.request;
  assertQuestionRequest(request);
  return {
    interactionId: event.payload.interactionId,
    messageId: request.messageId,
    expiresAt: event.payload.expiresAt,
    fields: request.questions,
    // 每题一个选项原文或自定义文本；成功仅表示 Provider 已接纳。
    submit: (answers: { questionId: string; text: string }[]) =>
      client.respondInteraction(invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "answered",
        value: { schema: "octo.question-response/v1", answers }
      }),
    dismiss: () =>
      client.respondInteraction(invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "cancelled"
      })
  };
}
