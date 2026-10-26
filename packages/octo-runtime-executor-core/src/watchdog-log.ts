import type { WatchdogDiagnostic } from "./watchdog.js";

/** 只投影已知执行测量；不展开诊断对象或将原始错误混入元数据日志。 */
export function watchdogLogData(diagnostic: WatchdogDiagnostic): Record<string, unknown> {
  const data = diagnostic.data;
  return {
    phase: data.phase,
    elapsed_ms: data.elapsedMs,
    phase_age_ms: data.phaseAgeMs,
    last_canonical_age_ms: data.lastCanonicalAgeMs,
    last_progress_age_ms: data.lastProgressAgeMs,
    last_transport_age_ms: data.lastTransportAgeMs,
    max_canonical_gap_ms: data.maxCanonicalGapMs,
    max_progress_gap_ms: data.maxProgressGapMs,
    open_tool_count: data.openToolCount,
    pending_interaction_count: data.pendingInteractionCount,
    retry_count: data.retryCount,
    last_method: data.lastMethod,
    activity_support: data.activitySupport,
    model_idle_policy: data.modelIdlePolicy,
    timeout_stage: data.timeoutStage,
    timeout_ms: data.timeoutMs,
    timeout_reason: data.timeoutReason
  };
}
