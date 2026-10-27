import { createCodeBuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";

export const subscriptionMessage = "Quota exceeded: 429 企业订阅已到期，请联系企业管理员续费。";
export const subscriptionResult = {
  type: "prompt_result",
  stopReason: "refusal",
  _meta: {
    "codebuddy.ai/outcome": "FAILED_MODEL_REQUEST",
    "codebuddy.ai/errorMessage": JSON.stringify({
      code: -32003,
      message: subscriptionMessage,
      data: { statusCode: 429, code: 14015, category: "quota" }
    })
  }
};
export const answer = { sessionUpdate: "agent_message_chunk", content: { text: "Hello" } };
export const endTurn = { type: "prompt_result", stopReason: "end_turn" };
export const scenarios = {
  success: [answer, endTurn],
  subscription: [subscriptionResult],
  partial: [answer, subscriptionResult],
  empty: [endTurn],
  whitespace: [{ sessionUpdate: "agent_message_chunk", content: { text: " \n " } }, endTurn],
  toolOnly: [{ sessionUpdate: "tool_call", toolCallId: "tool", name: "read", input: {} }, endTurn],
  reasoning: [{ sessionUpdate: "agent_thought_chunk", content: { text: "Thinking" } }, endTurn],
  cancelled: [{ type: "prompt_result", stopReason: "cancelled" }]
};

// 离线 ACP fixture；不启动 Provider，也不读取本机账号。调用方负责 executor/Kernel 的关闭。
export function codeBuddyFixture({
  updates,
  sessionResult = { sessionId: "fixture-session" }
} = {}) {
  const state = { calls: [], promptCalls: 0, closes: 0 };
  const adapter = createCodeBuddyAdapter({
    acpClientFactory: () => {
      let nextId = 0;
      let closed = false;
      return {
        initialize: async () => ({}),
        reserveRequestId: () => ++nextId,
        request: async (method, params) => {
          state.calls.push({ method, params });
          return sessionResult;
        },
        async *prompt(_sessionId, prompt) {
          state.promptCalls++;
          const scenario = Object.keys(scenarios).find((key) => prompt.includes(`fixture:${key}`));
          yield* updates ?? scenarios[scenario ?? "success"];
        },
        close: async () => {
          if (!closed) state.closes++;
          closed = true;
        }
      };
    }
  });
  return { adapter, state };
}
