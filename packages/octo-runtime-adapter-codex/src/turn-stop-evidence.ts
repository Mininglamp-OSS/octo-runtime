/**
 * 仅由原生 turn/completed 确认真实执行停止。代理进程退出和 interrupt ACK 均不是停止证明。
 * 观察者属于单次 Adapter invocation；取消时可继续短暂读尾流，超过预算仍保持未知。
 */
export class CodexTurnStopEvidence {
  #threadId?: string;
  #turnId?: string;
  #confirmed = false;
  #resolve: () => void = () => {};
  readonly #stopped = new Promise<void>((resolve) => {
    this.#resolve = resolve;
  });
  thread(id: string): void {
    this.#threadId = id;
  }
  turn(id: string): void {
    this.#turnId = id;
  }
  observe(
    method: string,
    params: Record<string, unknown>
  ): "completed" | "failed" | "cancelled" | undefined {
    if (this.#confirmed || method !== "turn/completed" || !this.#threadId || !this.#turnId)
      return undefined;
    const turn =
      params.turn && typeof params.turn === "object"
        ? (params.turn as Record<string, unknown>)
        : undefined;
    const turnId = params.turnId ?? turn?.id;
    if (
      params.threadId !== this.#threadId ||
      turnId !== this.#turnId ||
      !["completed", "failed", "interrupted"].includes(String(turn?.status))
    )
      return undefined;
    this.#confirmed = true;
    this.#resolve();
    return turn?.status === "interrupted"
      ? "cancelled"
      : turn?.status === "completed"
        ? "completed"
        : "failed";
  }
  async wait(ms: number): Promise<void> {
    if (this.#confirmed || !this.#turnId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#stopped,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
