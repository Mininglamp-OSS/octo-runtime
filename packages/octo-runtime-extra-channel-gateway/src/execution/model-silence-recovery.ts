import type { CanonicalEvent } from "@mininglamp-oss/octo-runtime-protocol";
import type { ImInvocationInput } from "./dispatcher.js";

/** 仅识别已确认可续接的模型静默；工具失败/取消/缺帧会永久关闭本轮续接资格。 */
export class ModelSilenceRecovery {
  readonly #tools = new Set<string>();
  #unsafe = false;
  #resumes = 0;
  observe(event: CanonicalEvent): void {
    if (this.#unsafe) return;
    if (event.type === "interaction.requested") this.#unsafe = true;
    if (event.type === "tool_call.create") {
      // 缺帧/重复身份不能证明工具结束；有界记录不足时关闭续接，不保留无界工具清单。
      if (this.#tools.has(event.payload.id) || this.#tools.size >= 1024) {
        this.#unsafe = true;
        this.#tools.clear();
      } else this.#tools.add(event.payload.id);
    }
    if (event.type === "tool_call.delta" && !this.#tools.has(event.payload.id)) this.#unsafe = true;
    if (event.type === "tool_call.update") {
      if (!this.#tools.delete(event.payload.id) || event.payload.status !== "completed")
        this.#unsafe = true;
    }
  }
  /** 终态和正常耗尽由 ImTask 先确认；清理完成必须来自本次 Core，而不是取消 ACK。 */
  canResume(event: CanonicalEvent, request: ImInvocationInput, maximum: number): boolean {
    if (event.type !== "run.failed") return false;
    const failure = event.payload.failure;
    return (
      !this.#unsafe &&
      this.#tools.size === 0 &&
      this.#resumes < maximum &&
      !!request.providerSession?.sessionId &&
      request.providerSession.resumable !== false &&
      failure?.code === "OH-ADP-3008" &&
      failure.source.adapter === "codex" &&
      failure.params?.timeoutReason === "model_silence" &&
      failure.params.executionCleanup === "complete" &&
      failure.params.executionStopped === "confirmed" &&
      failure.params.executionStoppedState === "cancelled" &&
      failure.params.openToolCount === 0
    );
  }
  resumeInputs(): ImInvocationInput["inputs"] {
    this.#resumes++;
    return [
      {
        type: "text",
        text: "上一次执行因模型静默超时已停止。请在当前会话继续完成用户尚未完成的任务，先核对已有进展和工具结果；不要重复已完成的操作。若无法确认某项外部操作是否成功，先核实结果，无法核实时说明情况并停止。"
      }
    ];
  }
}
