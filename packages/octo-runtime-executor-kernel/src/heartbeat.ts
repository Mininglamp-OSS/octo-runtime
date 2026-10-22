import { performance } from "node:perf_hooks";

/** 监督器暂停不等于 worker 失联；跨间隔后必须由新 probe 独立证明存活。 */
export class WorkerHeartbeat {
  #wall: number;
  #mono: number;
  #sequence = 0;
  #pending?: { id: number; deadline: number };
  #answered = false;
  activeMs = 0;
  healthyMs = 0;
  constructor(
    private readonly wallNow = Date.now,
    private readonly monotonicNow = () => performance.now()
  ) {
    this.#wall = wallNow();
    this.#mono = monotonicNow();
  }
  #gap(wall: number, mono: number): boolean {
    return (
      wall < this.#wall ||
      mono < this.#mono ||
      wall - this.#wall >= 5000 ||
      mono - this.#mono >= 5000
    );
  }
  tick(): { type: "ping"; id: number } | { type: "waiting" | "expired" } {
    const wall = this.wallNow(),
      mono = this.monotonicNow();
    if (this.#gap(wall, mono)) {
      this.#pending = undefined;
      this.#answered = false;
      this.healthyMs = 0;
    } else {
      const elapsed = mono - this.#mono;
      this.activeMs += elapsed;
      if (this.#answered) this.healthyMs += elapsed;
    }
    this.#wall = wall;
    this.#mono = mono;
    this.#answered = false;
    if (this.#pending) return { type: mono >= this.#pending.deadline ? "expired" : "waiting" };
    this.#pending = { id: ++this.#sequence, deadline: mono + 5000 };
    return { type: "ping", id: this.#sequence };
  }
  pong(id: unknown): void {
    const wall = this.wallNow(),
      mono = this.monotonicNow();
    // 迟到旧 pong 不能延长新的宽限期；暂停期间排队的 pong 也不证明恢复后的存活。
    if (
      this.#gap(wall, mono) ||
      !this.#pending ||
      id !== this.#pending.id ||
      mono >= this.#pending.deadline
    )
      return;
    this.#pending = undefined;
    this.#answered = true;
  }
}
