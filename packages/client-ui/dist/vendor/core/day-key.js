/**
 * 北京时间自然日（docs/02 §1.2 每日用量上限；docs/04 §1 Gate 1 dailyQuota）
 *
 * AMD 的每日 pts 上限按北京时间自然日累计，00:00 UTC+8 重置。
 * 计算必须显式使用 +480 分钟偏移，不依赖宿主 TZ：进程跑在 UTC / LA / 任何时区结果都一样。
 */
export const BEIJING_OFFSET_MINUTES = 480;
const DAY_MS = 86_400_000;
/** 严格 'YYYY-MM-DD'，在建时戳之前挡掉 '2026-13-01' / '2026-2-3' 之类。 */
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidEpoch(epochMs) {
    return Number.isFinite(epochMs) && epochMs >= 0 && epochMs <= 8.64e15;
}
/**
 * 任意 epoch(ms) → 'YYYY-MM-DD'，按给定分钟偏移的时区日。
 * offsetMinutes = 0 时就是 UTC 日。
 */
export function dayKeyOf(epochMs, offsetMinutes) {
    if (!isValidEpoch(epochMs) || !Number.isFinite(offsetMinutes))
        return null;
    const d = new Date(epochMs + offsetMinutes * 60_000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (year < 1000 || year > 9999)
        return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** 北京时间自然日 key（AMD 每日上限的计费桶）。 */
export function beijingDayKey(epochMs) {
    return dayKeyOf(epochMs, BEIJING_OFFSET_MINUTES);
}
/** 'YYYY-MM-DD' → 该日 00:00+08 的绝对毫秒（UTC 前一日 16:00Z）。非法 → null。 */
export function beijingResetEpochMs(dayKey) {
    const m = DAY_KEY_RE.exec(dayKey.trim());
    if (!m)
        return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const utcMidnight = Date.UTC(year, month - 1, day);
    const back = new Date(utcMidnight);
    if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
        return null;
    }
    return utcMidnight - BEIJING_OFFSET_MINUTES * 60_000;
}
/** 距下一次北京时间 00:00 剩余的毫秒；用于 UI 的「北京时间 00:00 重置」。 */
export function msUntilBeijingReset(nowMs) {
    const key = beijingDayKey(nowMs);
    if (key === null)
        return null;
    const start = beijingResetEpochMs(key);
    if (start === null)
        return null;
    const remaining = start + DAY_MS - nowMs;
    return remaining > 0 ? remaining : null;
}
//# sourceMappingURL=day-key.js.map