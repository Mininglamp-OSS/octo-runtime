/**
 * 解析 HTTP Retry-After 的秒数或日期，返回相对 nowMs 的非负毫秒数。
 * 无效值返回 undefined，过去日期返回零；默认退避和等待预算由调用方决定。
 * 有限秒数换算溢出时保留 Infinity，使 REST 仍能按超预算拒绝，不能退回短等待。
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs = Date.now()
): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    // 数字先分类，避免负数或零被 Date.parse 误认成日历日期。
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : undefined;
}
