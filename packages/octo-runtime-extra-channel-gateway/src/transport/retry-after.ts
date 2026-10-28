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
  const rfc850 =
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
      value
    );
  let date: number;
  if (rfc850) {
    // RFC 9110 的两位年份窗口随当前时间移动，不能沿用 Date.parse 的固定世纪分界。
    const [, day, month, shortYear, time] = rfc850;
    const limit = new Date(nowMs);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    const year = Math.floor(limit.getUTCFullYear() / 100) * 100 + Number(shortYear);
    const atYear = (fullYear: number) => Date.parse(`${day} ${month} ${fullYear} ${time} GMT`);
    date = atYear(year);
    // 比较完整 UTC 时间戳：恰好 50 年保留，超过才回到最近的过去世纪。
    if (date > limit.getTime()) date = atYear(year - 100);
  } else {
    // asctime 无时区后缀，但含义仍是 UTC；不能让 Date.parse 使用本地时区。
    const asctime =
      /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:\d{2}| \d) \d{2}:\d{2}:\d{2} \d{4}$/.test(
        value
      );
    date = Date.parse(asctime ? `${value} GMT` : value);
  }
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : undefined;
}
