/**
 * 投递回执与重试：按 effectKey 记录发送结果，避免已确认的消息重复投递。
 * 只重试投递操作；执行失败或网络结果未知都不能由此触发 AgentRun 重跑。
 */
import type { ImDeliveryReceipt } from "../contracts.js";
import { sanitizeDiagnosticBody } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { OctoApiError } from "../transport/api/errors.js";
import { ImSendError } from "./text-send.js";

export class ImDeliveryDispatcher {
  readonly #receipts = new Map<string, ImDeliveryReceipt>();
  constructor(readonly signal: AbortSignal) {}
  /** 状态仅读取数量，避免复制和输出用于防重的内部回执。 */
  get receiptCount(): number {
    return this.#receipts.size;
  }

  async deliver(
    effectKey: string,
    operation: () => Promise<string | void>,
    options: {
      transient?: boolean;
      obsolete?: () => boolean;
      cardOperation?: "send" | "edit";
      onDiagnostic?: (code: string, data?: Record<string, unknown>) => void;
    } = {}
  ): Promise<ImDeliveryReceipt> {
    const previous = this.#receipts.get(effectKey);
    if (previous?.state === "delivered") return { ...previous };
    const attempts = options.transient ? 1 : 3;
    let receipt: ImDeliveryReceipt = { effectKey, state: "pending" };
    this.#record(receipt);
    for (let attempt = 0; attempt < attempts && !this.signal.aborted; attempt++) {
      if (options.obsolete?.()) break;
      try {
        const messageId = await operation();
        receipt = { effectKey, state: "delivered", ...(messageId ? { messageId } : {}) };
        this.#record(receipt);
        return receipt;
      } catch (error) {
        const status = error instanceof OctoApiError ? error.status : undefined;
        // 无 HTTP 回应时可能已经送达；保留 unknown，不能把网络异常当作确定未发送。
        const state = error instanceof ImSendError ? error.state : status ? "failed" : "unknown";
        receipt = {
          effectKey,
          state: receipt.state === "unknown" ? "unknown" : state,
          code:
            error instanceof ImSendError
              ? error.code
              : status
                ? options.cardOperation
                  ? `IM_CARD_${options.cardOperation.toUpperCase()}_${status}`
                  : `IM_HTTP_${status}`
                : "IM_DELIVERY_UNKNOWN"
        };
        this.#record(receipt);
        // HTTP 状态只描述本次投递，不代表业务永久失败；诊断先脱敏再限长，不记录请求正文。
        try {
          options.onDiagnostic?.(
            receipt.code!,
            options.cardOperation && error instanceof OctoApiError
              ? {
                  path: error.path.split(/[?#]/, 1)[0],
                  http_status: error.status,
                  response_body: sanitizeDiagnosticBody(error.body)
                }
              : undefined
          );
        } catch {
          /* 诊断回调失败不得改变投递结果或触发额外发送。 */
        }
        // WS 已在同一确认窗口完成四次预算，不再叠乘 REST 的重试次数。
        if (error instanceof ImSendError) break;
        if (status && status !== 429 && status < 500) break;
        if (attempt + 1 === attempts) break;
        const delay =
          error instanceof OctoApiError && status === 429
            ? error.retryAfterMs
            : 200 * (attempt + 1);
        if (delay > 3_000) break;
        try {
          await new Promise<void>((resolve, reject) => {
            const abort = (): void => {
              clearTimeout(timer);
              this.signal.removeEventListener("abort", abort);
              reject(new Error("IM_DELIVERY_CANCELLED"));
            };
            const timer = setTimeout(() => {
              this.signal.removeEventListener("abort", abort);
              resolve();
            }, delay);
            this.signal.addEventListener("abort", abort, { once: true });
            if (this.signal.aborted) abort();
          });
        } catch {
          break;
        }
      }
    }
    if (receipt.state === "pending") {
      receipt = { effectKey, state: "failed", code: "IM_DELIVERY_CANCELLED" };
      try {
        options.onDiagnostic?.(receipt.code!);
      } catch {
        /* 取消诊断同样不能阻断清理。 */
      }
    }
    this.#record(receipt);
    return receipt;
  }
  #record(receipt: ImDeliveryReceipt): void {
    this.#receipts.set(receipt.effectKey, receipt);
    if (this.#receipts.size > 512) this.#receipts.delete(this.#receipts.keys().next().value!);
  }
}
