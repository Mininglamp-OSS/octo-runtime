/**
 * Octo 接入编排：直连 IM Server，完成身份准入、Context 读取、卡片与按钮回传。
 * 此通道就是 IM 事件发起方；只处理 IM 归属，不合成文档评论或其他领域请求。
 */
import { CONTEXT_SCHEMA } from "@mininglamp-oss/octo-runtime-protocol";
import type { ChannelCallbacks, OctoBotConfig, ImRunControls, ImAddress } from "../contracts.js";
import type { InteractionRequestedPayload } from "@mininglamp-oss/octo-runtime-protocol";
import { interactionCard, interactionAnswer } from "./interaction-card.js";
import type { ImCredentialSource } from "../ports.js";
import { imBotIdentity } from "../lifecycle/configuration.js";
import { verifyBotIdentity } from "./auth.js";
import { registerBot, WukongConnection } from "./wukong.js";
import { acceptsImMessage, groupScope, isRulesNotification, rulesChange } from "./normalize.js";
import { build_im_contexts } from "./contexts.js";
import { OctoConnector, stableEffectKey } from "./connector.js";
import { CardSession } from "./card-session.js";
import { TypingController } from "../presentation/typing.js";
import { ImRunProjector } from "../presentation/run-projector.js";
import { buildReasoningFrame } from "./reasoning-frame.js";
import { ImDeliveryDispatcher } from "../delivery/dispatcher.js";
import { ImDeliveryScope, type ImDeliveryIdentity } from "../delivery/identity.js";
import { fetchBotEvents, ackBotEvent } from "./api/events.js";
import { parseCardAction } from "./card-action.js";
import { setTimeout as delay } from "node:timers/promises";
import { octoCliEnvironment } from "../execution/tool-environment.js";
import { downloadImageInput } from "./image-input.js";
import { prepareFinalMention } from "./mentions.js";
import { getGroupMembers, type GroupMember } from "./api/conversations.js";
import { getJson, type HttpRequestDispatch } from "./api/client.js";
import { connectionFailure, ImConnectionError } from "./connection-error.js";
import { sendReadReceipt } from "./api/messages.js";
import { ImSendError } from "../delivery/send-error.js";
import type { ImGapTurnToken } from "../application/context-gap.js";
import { assistantOutputFingerprint } from "../application/context-gap.js";
import { observesImScope } from "./normalize.js";
import { prepareArtifacts } from "../delivery/artifacts.js";
import { uploadChatAttachment } from "./api/files.js";
import { MessageIdentityCache } from "./message-identities.js";

/** Octo IM 平台连接器：WuKong 与 Octo REST 适配；不是 MCP 连接器。 */
export class GatewayTransport {
  identity: string;
  readonly botId: string;
  #detachAbort?: () => void;
  #closing?: Promise<void>;
  #connection?: WukongConnection;
  #spaceId = "";
  #token?: string;
  #deliveryScope = new ImDeliveryScope();
  get scopedConfig() {
    return { ...this.config, spaceId: this.#spaceId };
  }
  #connected = false;
  #closed = true;
  #abort = new AbortController();
  #typing?: TypingController;
  #api?: OctoConnector;
  #delivery?: ImDeliveryDispatcher;
  #polling?: Promise<void>;
  readonly #messageIdentityCache = new MessageIdentityCache();
  readonly #bindings = new Map<
    string,
    {
      card: CardSession;
      address: ImAddress;
      senderId: string;
      controls: ImRunControls;
      expires: number;
      active: boolean;
      turn?: ImGapTurnToken;
      interactions: Map<string, { request: InteractionRequestedPayload; messageId: string }>;
      resolveInteraction: (id: string, status: string) => Promise<void>;
    }
  >();
  constructor(
    readonly config: OctoBotConfig,
    readonly credentials: ImCredentialSource,
    readonly callbacks: ChannelCallbacks,
    // Bot 持有任务准备与 REST 投递的期限、凭据及身份，接收 WS 不拥有这些资源。
    readonly deliveryOwner?: {
      signal: AbortSignal;
      dispatcher: ImDeliveryDispatcher;
      identity: ImDeliveryIdentity;
      token?: () => string | undefined;
      /** 身份及空间准入后同步发布凭据；候选值不得提前供旧任务读取。 */
      acceptToken?: (token: string) => void;
    }
  ) {
    this.identity = imBotIdentity(config);
    this.botId = config.bot_id;
  }
  get status() {
    return {
      connected: this.#connected,
      cardDeliveries: (this.deliveryOwner?.dispatcher ?? this.#delivery)?.receiptCount ?? 0
    };
  }
  async start(signal: AbortSignal): Promise<void> {
    this.#closed = false;
    signal = AbortSignal.any([signal, this.#abort.signal]);
    const token = (await this.credentials(this.config, signal))?.trim();
    if (!token) throw new Error("IM_CREDENTIALS_REQUIRED");
    if (!/^bf_[A-Za-z0-9_-]+$/.test(token)) throw new Error("IM_BOT_TOKEN_INVALID");
    const principal = await verifyBotIdentity(this.config.api_url, token, signal);
    signal.throwIfAborted();
    try {
      if (principal.bot_uid !== this.config.bot_id) throw new Error("IM_BOT_IDENTITY_MISMATCH");
      this.callbacks.authorizeSpace?.(principal.space_id);
    } catch (error) {
      // REST 在核验期间继续使用旧凭据；明确拒绝目标后必须撤销旧任务权限。
      // 只在明确身份/空间拒绝后撤销，网络失败、单纯换 token 和握手失败不走此分支。
      this.deliveryOwner?.identity.revoke();
      this.#deliveryScope.revoke();
      throw error;
    }
    signal.throwIfAborted();
    this.#token = token;
    this.#spaceId = principal.space_id;
    this.identity = `${imBotIdentity(this.config)}:${encodeURIComponent(this.#spaceId)}`;
    // 必须在身份核验及空间准入成功后推进代次；连接失败/再次重连不能复活旧代次。
    this.#deliveryScope = this.deliveryOwner?.identity.accept(this.identity) ?? this.#deliveryScope;
    // 代次与凭据在同一同步段生效，不等待后续注册或 WS 握手。
    this.deliveryOwner?.acceptToken?.(token);
    const registration = await registerBot(this.config.api_url, token, signal);
    const toolEnvironment = octoCliEnvironment(this.config.api_url, token);
    if (signal.aborted) return;
    if (registration.robot_id !== this.config.bot_id) {
      // 注册明确拒绝身份也属于授权撤销；网络/握手失败则保留已核验凭据和任务。
      this.deliveryOwner?.identity.revoke();
      this.#deliveryScope.revoke();
      throw new Error("IM_BOT_IDENTITY_MISMATCH");
    }
    const connection = new WukongConnection(
      (message) => {
        if (this.#closed) return;
        // 服务端规则通知即使 @ 全部 Bot，也只失效上下文，不能进入任务/卡片路径。
        if (isRulesNotification(message)) {
          const change = rulesChange(message);
          if (
            change &&
            observesImScope(
              this.scopedConfig,
              message.channelId,
              message.channelType,
              message.payload.space_id
            )
          )
            this.callbacks.onRulesChanged?.(change);
          return;
        }
        if (!acceptsImMessage(this.scopedConfig, message)) return;
        let finalReply: { key: string; value: ReturnType<typeof prepareFinalMention> } | undefined;
        let finalOutputCovered = false;
        const deliverySignal = AbortSignal.any([
          this.deliveryOwner?.signal ?? signal,
          this.#deliveryScope.signal
        ]);
        // 任务的普通回复、final、进度及失败卡共用 REST 工厂和任务期限。
        const restDelivery = (turnSignal = deliverySignal, obsolete?: () => boolean) =>
          new OctoConnector(
            this.config,
            token,
            AbortSignal.any([deliverySignal, turnSignal]),
            (requestSignal, send) =>
              this.#dispatchRestDelivery(requestSignal, (authorized, botToken) => {
                if (obsolete?.()) throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
                return send(authorized, botToken);
              })
          );
        const finalDispatcher = this.#delivery!;
        let historyTurn: ImGapTurnToken | undefined;
        const outputObserver = (payload?: Record<string, unknown>) => {
          const turn = historyTurn;
          if (!turn || !observesImScope(this.scopedConfig, message.channelId, message.channelType))
            return undefined;
          return (messageSeq: number) => {
            if (deliverySignal.aborted) return;
            (this.callbacks.onTaskPosition ?? this.callbacks.onPosition)?.({
              conversationId: message.channelId,
              conversationKind: message.channelType === 5 ? "thread" : "group",
              messageSeq,
              own: true,
              turn,
              ...(payload && turn.providerSessionId
                ? { outputFingerprint: assistantOutputFingerprint(payload) }
                : {})
            });
          };
        };
        // 同一次在途 HTTP 共用 Promise；失败交回当前投递器，只有收尾拥有三次重试预算。
        const sends = new Map<string, Promise<string>>();
        const sendMessage = (
          payload: Record<string, unknown>,
          key: string,
          turnSignal: AbortSignal,
          obsolete?: () => boolean,
          observe?: (sequence: number) => void
        ): Promise<string> => {
          turnSignal.throwIfAborted();
          if (obsolete?.()) throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
          if (this.#deliveryScope.isConfirmed(key)) return Promise.resolve("");
          const pending = sends.get(key);
          if (pending) return pending;
          const sending = restDelivery(turnSignal, obsolete)
            .message(message, payload, key, observe)
            .then(
              (id) => {
                this.#deliveryScope.confirm(key);
                sends.delete(key);
                return id;
              },
              (error: unknown) => {
                sends.delete(key);
                throw error;
              }
            );
          sends.set(key, sending);
          return sending;
        };
        this.callbacks.onMessage({
          messageId: message.messageId,
          ...(message.channelType === 2 || message.channelType === 5
            ? {
                position: { messageSeq: message.messageSeq },
                bindHistoryTurn: (turn: ImGapTurnToken) => {
                  historyTurn = structuredClone(turn);
                }
              }
            : {}),
          markRead: (turnSignal) =>
            sendReadReceipt({
              apiUrl: this.config.api_url,
              botToken: this.#taskToken(deliverySignal),
              channelId: message.channelId,
              channelType: message.channelType,
              messageIds: [message.messageId],
              signal: AbortSignal.any([deliverySignal, turnSignal])
            }),
          senderId: message.fromUid,
          conversationId: message.channelId,
          conversationKind:
            message.channelType === 1 ? "direct" : message.channelType === 5 ? "thread" : "group",
          text:
            message.payload.type === 2
              ? ""
              : message.payload.type === 11 || message.payload.type === 14
                ? `收到一条${message.payload.type === 14 ? "富文本" : "合并转发"}新消息；正文见本轮 extra.im/message-content。`
                : message.payload.type === 8 || message.payload.type === 18
                  ? typeof message.payload.content === "string" && message.payload.content.trim()
                    ? message.payload.content
                    : "请根据本轮资源上下文处理此资源。"
                  : String(message.payload.content),
          ...(message.payload.type === 2
            ? {
                buildInputs: (turnSignal: AbortSignal) =>
                  downloadImageInput(
                    message.payload.url,
                    this.config.api_url,
                    this.#taskToken(deliverySignal),
                    AbortSignal.any([deliverySignal, turnSignal])
                  )
              }
            : {}),
          executionEnvironment: () => {
            deliverySignal.throwIfAborted();
            return { executionEnvOverrides: structuredClone(toolEnvironment) };
          },
          runMetadata: {
            spaceId: this.#spaceId,
            botId: this.config.bot_id,
            channelType: message.channelType
          },
          replyFailure: async (event, effectKey, options) => {
            const rest = restDelivery(options?.signal, options?.obsolete);
            const template = await rest.reasoningTemplate();
            if (!template) return;
            const projector = new ImRunProjector(`channel:${effectKey}`, message.channelType === 1);
            projector.accept(event);
            const frame = buildReasoningFrame(projector.snapshot(), template);
            if (!frame) throw Error("IM_CARD_BUDGET_EXCEEDED");
            await rest.card(
              message,
              template,
              frame,
              stableEffectKey(this.identity, message, effectKey, "error"),
              undefined,
              1,
              false
            );
          },
          reply: async (text, effectKey, options) => {
            // 目标归属冻结在原消息，REST 使用 Bot 期限和持有凭据，不等待 WS 恢复。
            const replySignal = options
              ? AbortSignal.any([deliverySignal, options.signal])
              : deliverySignal;
            if (options?.obsolete()) throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
            const key = stableEffectKey(
              this.identity,
              message,
              effectKey ?? message.messageId,
              "text"
            );
            await sendMessage(
              { type: 1, content: text },
              key,
              replySignal,
              options?.obsolete,
              outputObserver()
            );
          },
          replyFinal: async (text, effectKey, options) => {
            const finalSignal = options
              ? AbortSignal.any([deliverySignal, options.signal])
              : deliverySignal;
            // 准备与投递共用任务身份，切网不取消；停止/换账号不能继续。
            this.#taskToken(finalSignal);
            if (options?.obsolete()) throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
            if (finalReply?.key !== effectKey)
              finalReply = {
                key: effectKey,
                // 整个准备按 effect 缓存，发送重试不再次上传；链接变化必须先于 mention 偏移计算。
                // 普通上传/成员查询故障在各准备函数内降级为正文；取消或身份撤销不能重建准备而复活。
                value: (async () => {
                  const delivered = options
                    ? await prepareArtifacts(
                        text,
                        options.artifacts,
                        finalSignal,
                        (bytes, name, mime, uploadSignal) =>
                          uploadChatAttachment(
                            this.config.api_url,
                            token,
                            bytes,
                            name,
                            mime,
                            uploadSignal,
                            this.#dispatchRestDelivery
                          )
                      )
                    : { text, files: [] };
                  const failures: string[] = [];
                  // 每张文件卡有独立回执；整段准备只执行一次，文本重试不重复卡片或上传。
                  for (const [index, file] of delivered.files.entries()) {
                    finalSignal.throwIfAborted();
                    if (options?.obsolete())
                      throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
                    const key = stableEffectKey(this.identity, message, effectKey, `file:${index}`);
                    const receipt = await finalDispatcher.deliver(
                      key,
                      async () => {
                        return sendMessage(
                          { type: 8, ...file },
                          key,
                          finalSignal,
                          () => Boolean(options?.obsolete()),
                          outputObserver(delivered.incomplete ? undefined : { type: 8, ...file })
                        );
                      },
                      { obsolete: () => finalSignal.aborted || Boolean(options?.obsolete()) }
                    );
                    if (receipt.state !== "delivered")
                      failures.push(
                        `${file.name.replace(/[\r\n\x60[\]<>]/g, "_").slice(0, 120)} (${receipt.state}: ${receipt.code ?? "IM_DELIVERY_UNKNOWN"})`
                      );
                  }
                  const finalText =
                    delivered.text +
                    (failures.length
                      ? `\n\nFile card delivery unconfirmed: ${failures.join("; ")}. The attachment download links above remain available; generation was not rerun.`
                      : "");
                  // 新增失败事实不在先前 assistant 中，不能因它由本机发送而过滤。
                  finalOutputCovered = !delivered.incomplete && failures.length === 0;
                  finalSignal.throwIfAborted();
                  return prepareFinalMention(finalText, async () => {
                    if ([2, 5].includes(message.channelType))
                      return getGroupMembers({
                        apiUrl: this.config.api_url,
                        botToken: token,
                        groupNo: groupScope(message.channelId).groupNo,
                        dispatchRequest: this.#dispatchRestDelivery,
                        signal: finalSignal
                      });
                    const peer = await getJson<GroupMember>(
                      this.config.api_url,
                      token,
                      `/v1/bot/user/info?uid=${encodeURIComponent(message.fromUid)}`,
                      AbortSignal.any([finalSignal, AbortSignal.timeout(5000)]),
                      {
                        maxResponseBytes: 64 << 10,
                        logRateLimit: false,
                        dispatchRequest: this.#dispatchRestDelivery
                      }
                    );
                    return peer?.uid === message.fromUid ? [peer] : [];
                  });
                })()
              };
            const result = await finalReply.value;
            if (options?.obsolete()) throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
            await sendMessage(
              {
                type: 1,
                content: result.text,
                ...(result.mention ? { mention: result.mention } : {})
              },
              stableEffectKey(this.identity, message, effectKey, "text"),
              finalSignal,
              () => Boolean(options?.obsolete()),
              outputObserver(
                finalOutputCovered
                  ? {
                      type: 1,
                      content: result.text,
                      ...(result.mention ? { mention: result.mention } : {})
                    }
                  : undefined
              )
            );
          },
          buildContext: async (turnSignal, options) => ({
            schema: CONTEXT_SCHEMA,
            items: await build_im_contexts(
              this.scopedConfig,
              message,
              this.#taskToken(deliverySignal),
              AbortSignal.any([deliverySignal, turnSignal]),
              {
                ...options,
                initialSession: options?.initialSession ?? false,
                identityCache: this.#messageIdentityCache
              }
            )
          }),
          beginPresentation: (runId, onDiagnostic, controls) => {
            // 卡片是 REST，不以 WS 存活为前提。保留同一 CardSession 的消息 ID/序号，
            // 仅 Bot 停止取消其请求；重连不将旧连接 signal 传入客户端或投递器。
            const progressApi = restDelivery();
            const interactions = new Map<
              string,
              { request: InteractionRequestedPayload; messageId: string }
            >();
            const resolveInteraction = async (id: string, status: string) => {
              const entry = interactions.get(id);
              if (!entry) return;
              const messageId = await progressApi.interactionCard(
                message,
                interactionCard(entry.request, status),
                stableEffectKey(this.identity, message, id, "interaction"),
                entry.messageId
              );
              // 能力不可用会返回 undefined；已显示卡片只有确认编辑成功后才能移除。
              if (messageId !== entry.messageId)
                throw new Error("IM_INTERACTION_CARD_FINALIZATION_UNCONFIRMED");
              interactions.delete(id);
            };
            const stopTyping =
              this.config.typing === false ? () => {} : this.#typing!.acquire(message, runId);
            const card = new CardSession(
              progressApi,
              finalDispatcher,
              message,
              runId,
              stopTyping,
              onDiagnostic
            );
            this.#bindings.set(runId, {
              card,
              address: message,
              senderId: message.fromUid,
              controls,
              expires: Date.now() + 86_400_000 + 30 * 60_000,
              active: true,
              turn: historyTurn,
              interactions,
              resolveInteraction
            });
            if (this.#bindings.size > 128) {
              const idle = [...this.#bindings].find(([, binding]) => !binding.active);
              if (idle) this.#bindings.delete(idle[0]);
            }
            if (!this.#polling) this.#polling = this.#pollActions(token, signal);
            return {
              interaction: async (request) => {
                // 旧按钮轮询不迁移；已失去绑定的连接不再创建无法响应的新交互。
                // 已开始的发卡及已存在卡片的收尾则继续使用任务 REST 期限。
                if (this.#closed || signal.aborted) return false;
                const document = interactionCard(request);
                const effect = stableEffectKey(
                  this.identity,
                  message,
                  request.interactionId,
                  "interaction"
                );
                let messageId: string | undefined;
                const receipt = await this.#delivery!.deliver(effect, async () => {
                  messageId = await progressApi.interactionCard(message, document, effect);
                  if (!messageId) throw Error("IM_INTERACTION_CARD_UNAVAILABLE");
                  return messageId;
                });
                if (receipt.state !== "delivered" || !receipt.messageId) return false;
                interactions.set(request.interactionId, {
                  request: structuredClone(request),
                  messageId: receipt.messageId
                });
                // REST 发卡期间 WS 可能已退出并清除按钮绑定。保留回执用于收尾，
                // 但仅仍可处理按钮的原绑定算可用，否则由 Runtime 发送文字交互命令。
                const binding = this.#bindings.get(runId);
                return (
                  !this.#closed &&
                  !signal.aborted &&
                  binding?.active === true &&
                  binding.interactions === interactions
                );
              },
              resolveInteraction,
              update: (snapshot) => card.update(snapshot),
              finish: async () => {
                const errors: unknown[] = [];
                try {
                  for (const id of interactions.keys()) {
                    try {
                      await resolveInteraction(id, "invalidated");
                    } catch (error) {
                      errors.push(error);
                      onDiagnostic("IM_INTERACTION_CARD_FAILED");
                    }
                  }
                  try {
                    await card.finish();
                  } catch (error) {
                    errors.push(error);
                  }
                  if (errors.length) throw new AggregateError(errors, "IM_PRESENTATION_FAILED");
                } finally {
                  // 仅保留按钮所需的轻量关联，避免卡片回调继续引用本轮投影上下文。
                  card.release();
                  const binding = this.#bindings.get(runId);
                  if (binding) {
                    binding.active = false;
                    binding.expires = Date.now() + 30 * 60_000;
                  }
                }
              }
            };
          }
        });
      },
      (error) => {
        this.#connected = false;
        const failure = connectionFailure(error);
        this.callbacks.onDisconnect(failure.message, failure.retryable);
      },
      (position) => {
        if (
          this.#closed ||
          signal.aborted ||
          !observesImScope(
            this.scopedConfig,
            position.channelId,
            position.channelType,
            position.spaceId
          )
        )
          return;
        const own = position.fromUid === this.config.bot_id;
        const binding = own
          ? [...this.#bindings.values()].find(
              (candidate) =>
                candidate.address.channelId === position.channelId &&
                candidate.address.channelType === position.channelType &&
                (candidate.card.effectKey === position.clientMsgNo ||
                  candidate.card.messageId === position.messageId ||
                  [...candidate.interactions.values()].some(
                    (entry) => entry.messageId === position.messageId
                  ))
            )
          : undefined;
        this.callbacks.onPosition?.({
          conversationId: position.channelId,
          conversationKind: position.channelType === 5 ? "thread" : "group",
          messageSeq: position.messageSeq,
          own,
          ...(binding?.turn ? { turn: binding.turn } : {})
        });
      }
    );
    this.#connection = connection;
    this.#api = new OctoConnector(this.config, token, signal);
    this.#delivery = this.deliveryOwner?.dispatcher ?? new ImDeliveryDispatcher(signal);
    this.#typing = new TypingController(
      (address, typingSignal) => this.#api!.typing(address, typingSignal),
      () => this.callbacks.onDiagnostic?.("IM_TYPING_FAILED")
    );
    const abort = (): void => {
      void connection.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    this.#detachAbort = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) return;
    await connection.connect(registration);
    if (signal.aborted) {
      await connection.close();
      return;
    }
    if (!connection.connected) throw new ImConnectionError("IM_DISCONNECTED", true);
    this.#connected = true;
  }
  /** REST 消费 Bot 已持有的凭据；WS 清理/鉴权/握手均不影响其准入。 */
  readonly #dispatchRestDelivery: HttpRequestDispatch = async (signal, send) => {
    const requestSignal = AbortSignal.any([
      signal,
      this.#deliveryScope.signal,
      ...(this.deliveryOwner ? [this.deliveryOwner.signal] : [])
    ]);
    try {
      const token = this.#taskToken(requestSignal);
      // 只读取已注入的值，不触发宿主获取/刷新；检查、替换头与 fetch 同步完成。
      return send(requestSignal, token);
    } catch (error) {
      this.#deliveryScope.signal.throwIfAborted();
      if (signal.aborted || this.deliveryOwner?.signal.aborted)
        throw new ImSendError("IM_DELIVERY_CANCELLED", "failed");
      throw error;
    }
  };
  /** 同步读取 Bot 已持有凭据并核验原任务归属；不检查或等待任何 WS 状态。 */
  #taskToken(signal: AbortSignal): string {
    signal.throwIfAborted();
    this.#deliveryScope.signal.throwIfAborted();
    this.deliveryOwner?.signal.throwIfAborted();
    const owner = this.deliveryOwner;
    // 身份撤销由 Bot 持有的 deliveryScope 保证，不读取当前 WS 或连接代次。
    const token = owner?.token ? owner.token()?.trim() : this.#token;
    if (!token) throw new ImSendError("IM_CREDENTIALS_REQUIRED", "failed");
    if (!/^bf_[A-Za-z0-9_-]+$/.test(token)) throw new ImSendError("IM_BOT_TOKEN_INVALID", "failed");
    return token;
  }
  async #pollActions(token: string, signal: AbortSignal): Promise<void> {
    if (this.config.cards === false) return;
    let cursor = 0,
      failures = 0;
    const handled = new Set<number>();
    while (!signal.aborted && !this.#closed) {
      const started = Date.now();
      try {
        const events = await fetchBotEvents({
          apiUrl: this.config.api_url,
          botToken: token,
          sinceEventId: cursor,
          limit: 100,
          waitSeconds: 30,
          signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)])
        });
        for (const event of events.sort((a, b) => a.event_id - b.event_id)) {
          if (signal.aborted) return;
          if (!Number.isSafeInteger(event.event_id) || event.event_id <= cursor) continue;
          // cursor 仅记录本地读取位置；不认识的领域事件不 ACK，也不转换成 IM 请求。
          const action = parseCardAction(event);
          if (!action) {
            cursor = event.event_id;
            continue;
          }
          if (
            action.spaceId !== this.#spaceId ||
            (this.config.allowed_sender_ids &&
              !this.config.allowed_sender_ids.includes(action.operatorUid))
          ) {
            cursor = event.event_id;
            continue;
          }
          let consumed = handled.has(event.event_id);
          for (const [id, binding] of this.#bindings) {
            if (consumed) break;
            if (binding.expires <= Date.now()) {
              this.#bindings.delete(id);
              continue;
            }
            const sameAddress =
              binding.address.channelId === action.channelId ||
              (Number(action.channelType) === 1 &&
                binding.address.channelId === `s${this.#spaceId}_${action.channelId}`);
            // 操作者、空间、原消息和地址均匹配才允许控制 Run，不信任表单中的归属声明。
            const interaction = [...binding.interactions.values()].find(
              (entry) => entry.messageId === action.messageId
            );
            if (
              (binding.card.messageId !== action.messageId && !interaction) ||
              binding.address.channelType !== Number(action.channelType) ||
              binding.senderId !== action.operatorUid ||
              !sameAddress
            )
              continue;
            if (interaction && action.actionId.startsWith("interaction_")) {
              if (!binding.active || !binding.controls.respond) continue;
              await binding.controls.respond(interactionAnswer(interaction.request, action));
              try {
                await binding.resolveInteraction(interaction.request.interactionId, "resolved");
              } catch {
                this.callbacks.onDiagnostic?.("IM_INTERACTION_CARD_FAILED");
              }
            } else if (!interaction && action.actionId === "reasoning_stop")
              await binding.controls.cancel();
            else if (!interaction && action.actionId === "reasoning_retry")
              binding.controls.retry(action.operatorUid, `card_action:${event.event_id}`);
            else continue;
            consumed = true;
            handled.add(event.event_id);
            break;
          }
          if (consumed) {
            await ackBotEvent({
              apiUrl: this.config.api_url,
              botToken: token,
              eventId: event.event_id,
              signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
            });
            handled.delete(event.event_id);
          }
          cursor = event.event_id;
          for (const id of handled) if (id <= cursor) handled.delete(id);
        }
        failures = 0;
        if (Date.now() - started < 1000) await delay(2_000, undefined, { signal });
      } catch {
        if (signal.aborted) return;
        this.callbacks.onDiagnostic?.("IM_CARD_ACTION_POLL_FAILED");
        try {
          await delay(Math.min(30_000, 2_000 * 2 ** failures++), undefined, { signal });
        } catch {
          return;
        }
      }
    }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#connected = false;
    this.#abort.abort();
    this.#detachAbort?.();
    this.#closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.#typing?.close()),
        Promise.resolve().then(() => this.#connection?.close()),
        this.#polling
      ]);
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result): unknown => result.reason);
      // WS 重连只移除按钮关联；仍在运行的 REST 卡片由任务 finish 负责释放。
      // 没有 Bot 所有者、Bot 已停止或任务已结束时，保留连接清理的兜底回收。
      for (const binding of this.#bindings.values())
        if (!binding.active || !this.deliveryOwner || this.deliveryOwner.signal.aborted)
          binding.card.release();
      this.#bindings.clear();
      if (errors.length) throw new AggregateError(errors, "IM_TRANSPORT_DISPOSE_FAILED");
    });
    return this.#closing;
  }
}
