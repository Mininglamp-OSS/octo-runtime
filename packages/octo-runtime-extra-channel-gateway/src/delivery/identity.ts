import { ImSendError } from "./text-send.js";

/** 一次已核验身份的投递权限及有界 ACK 账本；换身份永久取消，普通 WS 重建不取消。 */
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
  #current?: { identity: string; token: string; scope: ImDeliveryScope };

  accept(identity: string, token: string): ImDeliveryScope {
    if (this.#current?.identity !== identity || this.#current.token !== token) {
      this.#current?.scope.revoke();
      this.#current = { identity, token, scope: new ImDeliveryScope() };
    }
    return this.#current.scope;
  }
}
