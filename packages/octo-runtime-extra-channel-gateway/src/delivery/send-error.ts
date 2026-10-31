/** REST 投递错误保留本次请求的确认状态；不触发 WS 恢复或重新执行模型。 */
export class ImSendError extends Error {
  constructor(
    readonly code: string,
    readonly state: "failed" | "unknown"
  ) {
    super(code);
  }
}
