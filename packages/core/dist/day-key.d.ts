/**
 * 北京时间自然日（docs/02 §1.2 每日用量上限；docs/04 §1 Gate 1 dailyQuota）
 *
 * AMD 的每日 pts 上限按北京时间自然日累计，00:00 UTC+8 重置。
 * 计算必须显式使用 +480 分钟偏移，不依赖宿主 TZ：进程跑在 UTC / LA / 任何时区结果都一样。
 */
export declare const BEIJING_OFFSET_MINUTES = 480;
/**
 * 任意 epoch(ms) → 'YYYY-MM-DD'，按给定分钟偏移的时区日。
 * offsetMinutes = 0 时就是 UTC 日。
 */
export declare function dayKeyOf(epochMs: number, offsetMinutes: number): string | null;
/** 北京时间自然日 key（AMD 每日上限的计费桶）。 */
export declare function beijingDayKey(epochMs: number): string | null;
/** 'YYYY-MM-DD' → 该日 00:00+08 的绝对毫秒（UTC 前一日 16:00Z）。非法 → null。 */
export declare function beijingResetEpochMs(dayKey: string): number | null;
/** 距下一次北京时间 00:00 剩余的毫秒；用于 UI 的「北京时间 00:00 重置」。 */
export declare function msUntilBeijingReset(nowMs: number): number | null;
//# sourceMappingURL=day-key.d.ts.map