/**
 * Octo 出站适配：统一文本、typing 和模板卡片发送，以及服务端能力发现。
 * 持有调用方提供的凭据与取消期限；任务 REST 可使用 Bot 期限，不依赖单次 WS 存活。
 */
import { createHash } from "node:crypto";
import type { ImAddress, OctoBotConfig } from "../contracts.js";
import { getCardProfile, sendTemplateCardMessage, editTemplateCardMessage } from "./api/cards.js";
import { sendTyping } from "./api/messages.js";
import { selectReasoningTemplate } from "./cards.js";
import type { ReasoningFrame, ReasoningTemplate } from "./reasoning-frame.js";
import { postJson, type HttpRequestDispatch } from "./api/client.js";
import { ImSendError } from "../delivery/send-error.js";
import { OctoApiError } from "./api/errors.js";

export class OctoConnector {
  #profile?: { expires: number; template?: ReasoningTemplate };
  constructor(
    readonly config: OctoBotConfig,
    readonly token: string,
    readonly signal: AbortSignal,
    // 跨 WS 的 REST 使用 Bot 持有凭据及任务期限，不把 WS 状态当作 HTTP 准入。
    readonly dispatchRequest?: HttpRequestDispatch
  ) {}
  async reasoningTemplate(): Promise<ReasoningTemplate | undefined> {
    if (this.config.cards === false) return;
    if (this.#profile && this.#profile.expires > Date.now()) return this.#profile.template;
    const profile = await getCardProfile({
      apiUrl: this.config.api_url,
      botToken: this.token,
      signal: this.signal,
      dispatchRequest: this.#dispatch
    });
    const template = selectReasoningTemplate(profile);
    this.#profile = { expires: Date.now() + 300_000, template };
    return template;
  }
  // 3 秒 HTTP 预算从获准发出请求起算；准入回调直接执行 fetch，不返回异步许可。
  readonly #dispatch: HttpRequestDispatch = (signal, send) => {
    const owner = AbortSignal.any([this.signal, signal]);
    owner.throwIfAborted();
    const dispatch = (authorized: AbortSignal, botToken?: string): Promise<Response> =>
      send(AbortSignal.any([authorized, AbortSignal.timeout(3_000)]), botToken);
    return this.dispatchRequest ? this.dispatchRequest(owner, dispatch) : dispatch(owner);
  };

  async typing(address: ImAddress, signal: AbortSignal): Promise<void> {
    await sendTyping({
      apiUrl: this.config.api_url,
      botToken: this.token,
      ...address,
      signal,
      dispatchRequest: this.#dispatch
    });
  }
  /** 任务文本/文件经 REST 投递；返回真实消息 ID，位置可选，不以 WS ACK 确认。 */
  async message(
    address: ImAddress,
    payload: Record<string, unknown>,
    effectKey: string,
    onPosition?: (sequence: number) => void
  ): Promise<string> {
    const receipt = await postJson<{ message_id?: string; message_seq?: number }>(
      this.config.api_url,
      this.token,
      "/v1/bot/sendMessage",
      {
        channel_id: address.channelId,
        channel_type: address.channelType,
        payload,
        client_msg_no: effectKey
      },
      this.signal,
      { dispatchRequest: this.#dispatch, retryOn429: false }
    ).catch((error: unknown) => {
      // 无有效回应不标记送达；仅外层当前收尾可用同一消息身份进行有限 REST 重试。
      if (error instanceof ImSendError) throw error;
      if (error instanceof OctoApiError && error.status < 500) throw error;
      throw new ImSendError("IM_DELIVERY_UNKNOWN", "unknown");
    });
    const id = receipt?.message_id;
    if (!((typeof id === "string" && id.trim()) || (Number.isSafeInteger(id) && Number(id) > 0)))
      throw new ImSendError("IM_DELIVERY_RECEIPT_UNKNOWN", "unknown");
    const sequence = receipt?.message_seq;
    if (Number.isSafeInteger(sequence) && sequence! > 0) onPosition?.(sequence!);
    return String(id);
  }
  async interactionCard(
    address: ImAddress,
    card: Record<string, unknown>,
    effectKey: string,
    messageId?: string
  ): Promise<string | undefined> {
    if (this.config.cards === false) return;
    const profile = await getCardProfile({
      apiUrl: this.config.api_url,
      botToken: this.token,
      signal: this.signal,
      dispatchRequest: this.#dispatch
    });
    // 身份代次撤销不是能力不支持；保留取消原因供调用方区分已阻止的旧身份写入。
    this.signal.throwIfAborted();
    if (
      !profile.available ||
      !profile.enabled ||
      !profile.config?.interaction_enabled ||
      !profile.profiles?.includes("octo/v2")
    )
      return;
    const payload = {
      type: 17,
      profile: "octo/v2",
      card_version: "1.5",
      card,
      card_seq: messageId ? 2 : 1
    };
    if (
      Buffer.byteLength(JSON.stringify(payload)) >
      Number(profile.limits?.max_payload_bytes ?? 16384)
    )
      throw Error("IM_INTERACTION_CARD_TOO_LARGE");
    const result = await postJson<{ message_id?: string }>(
      this.config.api_url,
      this.token,
      messageId ? "/v1/bot/message/edit" : "/v1/bot/sendMessage",
      {
        channel_id: address.channelId,
        channel_type: address.channelType,
        ...(messageId
          ? { message_id: messageId, content_edit: JSON.stringify(payload) }
          : { payload, client_msg_no: effectKey })
      },
      this.signal,
      {
        retryOn429: false,
        dispatchRequest: this.#dispatch
      }
    );
    if (!messageId && !result?.message_id) throw Error("IM_DELIVERY_RECEIPT_UNKNOWN");
    return messageId ?? String(result!.message_id);
  }
  async card(
    address: ImAddress,
    template: ReasoningTemplate,
    frame: ReasoningFrame,
    effectKey: string,
    messageId?: string,
    seq = 1,
    transient = true
  ): Promise<string> {
    const common = {
      apiUrl: this.config.api_url,
      botToken: this.token,
      ...address,
      templateRef: template.ref,
      state: frame.state,
      data: frame,
      signal: this.signal,
      dispatchRequest: this.#dispatch,
      retryOn429: false
    };
    if (messageId) {
      await editTemplateCardMessage({ ...common, messageId, cardSeq: seq, transient });
      return messageId;
    }
    const receipt = await sendTemplateCardMessage({ ...common, clientMsgNo: effectKey });
    if (!receipt?.message_id) throw new Error("IM_DELIVERY_RECEIPT_UNKNOWN");
    return String(receipt.message_id);
  }
}

export function stableEffectKey(
  endpointId: string,
  address: ImAddress,
  runId: string,
  kind: string
): string {
  const id = createHash("sha256")
    .update([endpointId, String(address.channelType), address.channelId, runId, kind].join("\0"))
    .digest("hex")
    .slice(0, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
