import { ImSendError } from "./send-error.js";

/** 一次已核验目标身份的投递权限及有界 REST 回执缓存；更新 token 或重建 WS 不取消。 */
export class ImDeliveryScope {
  readonly #abort = new AbortController();
  readonly #confirmed = new Set<string>();
  readonly signal: AbortSignal = this.#abort.signal;

  revoke(): void {
    this.#abort.abort(new ImSendError("IM_CONNECTION_IDENTITY_CHANGED", "failed"));
  }

  confirm(key: string): void {
    if (this.signal.aborted) return;
    this.#confirmed.add(key);
    if (this.#confirmed.size > 512) this.#confirmed.delete(this.#confirmed.values().next().value!);
  }

  isConfirmed(key: string): boolean {
    return this.#confirmed.has(key);
  }
}

/** 归 Bot 所有；只接受核验成功的身份，不随 current transport 的替换遗忘旧代次失效。 */
export class ImDeliveryIdentity {
  #current?: { identity: string; scope: ImDeliveryScope };

  /** 明确拒绝目标身份/空间后关闭旧代次；后续恢复到相同身份也不能复活旧投递。 */
  revoke(): void {
    this.#current?.scope.revoke();
    this.#current = undefined;
  }

  accept(identity: string): ImDeliveryScope {
    if (this.#current?.identity !== identity) {
      this.#current?.scope.revoke();
      this.#current = { identity, scope: new ImDeliveryScope() };
    }
    return this.#current.scope;
  }
}
