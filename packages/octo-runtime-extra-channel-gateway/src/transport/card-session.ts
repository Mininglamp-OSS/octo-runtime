import { imBotIdentity } from "../lifecycle/configuration.js";
/**
 * 单 Run 卡片会话：首次创建、后续编辑同一消息，并用序号和终态屏障收敛状态。
 * 终态展示被拒绝时有界降级到精简帧；确认投递后 finish 正常返回，仍失败则保留诊断。
 * 最终文本由执行编排独立投递；服务端回执不代表客户端已经渲染。
 */
import type { ImAddress } from "../contracts.js";
import type { OctoConnector } from "./connector.js";
import { stableEffectKey } from "./connector.js";
import type { ImDeliveryDispatcher } from "../delivery/dispatcher.js";
import { ProgressScheduler } from "../delivery/scheduler.js";
import {
  buildReasoningFrame,
  type ReasoningFrame,
  type ReasoningTemplate
} from "./reasoning-frame.js";
import type { RunPresentation } from "../presentation/run-projector.js";

export class CardSession {
  #messageId?: string;
  #seq = 0;
  #terminalFailed = false;
  #scheduler?: ProgressScheduler<RunPresentation>;
  #stopTyping?: () => void;
  #onDiagnostic?: (code: string, data?: Record<string, unknown>) => void;
  readonly effectKey: string;
  constructor(
    readonly connector: OctoConnector,
    readonly delivery: ImDeliveryDispatcher,
    readonly address: ImAddress,
    runId: string,
    stopTyping: () => void,
    onDiagnostic: (code: string, data?: Record<string, unknown>) => void
  ) {
    this.#stopTyping = stopTyping;
    this.#onDiagnostic = onDiagnostic;
    this.effectKey = stableEffectKey(imBotIdentity(connector.config), address, runId, "progress");
    this.#scheduler = new ProgressScheduler(
      async (snapshot) => {
        try {
          await this.#send(snapshot);
        } catch (error) {
          if (snapshot.terminal || snapshot.resultUnknown) this.#terminalFailed = true;
          throw error;
        }
      },
      () => this.#onDiagnostic?.("IM_CARD_FAILED")
    );
  }
  update(snapshot: RunPresentation): void {
    if (snapshot.terminal || snapshot.phase === "waiting") this.#stopTyping?.();
    this.#scheduler?.enqueue(snapshot, !!snapshot.terminal || !!snapshot.resultUnknown);
  }
  async #send(snapshot: RunPresentation): Promise<void> {
    if (!this.#scheduler) return;
    const settled = !!snapshot.terminal || !!snapshot.resultUnknown;
    const template = await this.connector.reasoningTemplate();
    if (!template) {
      if (settled && this.#messageId) this.#terminalFailed = true;
      this.#onDiagnostic?.("IM_CARD_UNAVAILABLE");
      return;
    }
    const frame = buildReasoningFrame(snapshot, template);
    if (!frame) {
      if (settled) this.#terminalFailed = true;
      this.#onDiagnostic?.("IM_CARD_BUDGET_EXCEEDED");
      return;
    }
    // 模板查询期间可能已收到终态；旧快照必须在出站前再次检查。
    if (!this.#scheduler || (this.#scheduler.terminal && !settled)) return;
    let receipt = await this.#deliver(frame, template, settled);
    // 400 不是业务终态。只在明确拒收后替换展示内容再投一次，不重放未知投递或另起可见卡片。
    if (
      settled &&
      receipt.state === "failed" &&
      (receipt.code === "IM_CARD_SEND_400" || receipt.code === "IM_CARD_EDIT_400")
    ) {
      const compact: ReasoningFrame = {
        reasoningId: frame.reasoningId,
        state: frame.state,
        title: "执行结果",
        statusLabel: frame.statusLabel,
        statusTone: frame.statusTone,
        traceExpanded: false,
        traceCollapsed: true,
        collapsedSummary: frame.statusLabel + " · 过程详情暂不可用，请查看最终回复或运行记录。",
        phases: [
          {
            thought: "过程详情暂不可用，请查看最终回复或运行记录。",
            actions: [
              {
                tool: "任务状态",
                detail: frame.statusLabel,
                statusGlyph: "●",
                statusTone: "Accent"
              }
            ]
          }
        ],
        ...(frame.state === "error"
          ? { errorTitle: "执行失败", errorMessage: "请查看最终回复或运行记录。" }
          : {})
      };
      receipt = await this.#deliver(compact, template, settled);
      if (receipt.state === "delivered") this.#onDiagnostic?.("IM_CARD_TERMINAL_DEGRADED");
    }
    if (receipt.state === "delivered") {
      // 后续更新绑定第一次成功发送的消息，不另起卡片；可见卡片接替 typing 提示。
      this.#messageId = receipt.messageId;
      this.#stopTyping?.();
    } else if (settled) this.#terminalFailed = true;
  }
  /** 沿同一卡片串行发送；降级帧也使用新序号和独立回执，保留取消与旧帧屏障。 */
  #deliver(frame: ReasoningFrame, template: ReasoningTemplate, settled: boolean) {
    const seq = ++this.#seq;
    return this.delivery.deliver(
      `${this.effectKey}:${seq}`,
      () =>
        this.connector.card(
          this.address,
          template,
          frame,
          this.effectKey,
          this.#messageId,
          seq,
          !settled
        ),
      {
        transient: !settled,
        obsolete: () => !this.#scheduler || (this.#scheduler.terminal && !settled),
        cardOperation: this.#messageId ? "edit" : "send",
        onDiagnostic: (code, data) => this.#onDiagnostic?.(code, data)
      }
    );
  }
  async finish(): Promise<void> {
    this.#stopTyping?.();
    await this.#scheduler?.flush();
    if (this.#terminalFailed) throw new Error("IM_CARD_FINALIZATION_FAILED");
  }
  /** 所有者完成 finish 后释放调度/回调；保留 messageId 供已有卡片按钮关联使用。 */
  release(): void {
    this.#scheduler?.dispose();
    this.#scheduler = undefined;
    this.#stopTyping = undefined;
    this.#onDiagnostic = undefined;
  }
  get messageId(): string | undefined {
    return this.#messageId;
  }
}
