import type { ProtocolMode, StreamLimitPolicy } from "@mininglamp-oss/octo-runtime-protocol";
import type { RuntimeLog } from "./runtime-log.js";

/** Provider progress used by the host watchdog to enforce execution deadlines. */
export interface ProviderActivity {
  kind: "turn_started" | "turn_progress" | "transport_response" | "retry_notice";
  method:
    | "turn_start"
    | "text_delta"
    | "tool_delta"
    | "item_lifecycle"
    | "usage"
    | "rpc_response"
    | "retry";
  toolCallId?: string;
  toolState?: "started" | "completed";
}

export interface AdapterInvocationContext {
  protocolMode?: ProtocolMode;
  streamLimits?: Readonly<StreamLimitPolicy>;
  /** Existing host metadata sink; never serialize or log provider bodies. */
  log?: RuntimeLog;
  reportConversion?(): void;
  reportActivity?(activity: ProviderActivity): void;
  /**
   * Adapter 仅在收到属于当前真实 Provider 执行的终态时确认停止。
   * 代理/子进程退出、连接关闭、取消 ACK 或本地合成终态不能调用；未报告时保持未知。
   */
  reportExecutionStopped?(outcome: "completed" | "failed" | "cancelled"): void;
}
