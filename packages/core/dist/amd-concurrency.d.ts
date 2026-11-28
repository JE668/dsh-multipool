/**
 * Per-minute folds of the events store that the dashboard draws but does not use for admission:
 * concurrency seen at send time, and queue-wait heat (docs/05 section 3.2).
 *
 * Like amd-trend.ts: a minute with no requests keeps its point, its value is null rather than 0,
 * and nothing here is invented.
 */
import type { MetricsEvent } from './contract.js';
/** The worst concurrency the host saw land in one drawn minute. */
export interface MinuteConcurrency {
    readonly atMs: number;
    /** null when that minute had no recorded request carrying a concurrency figure. */
    readonly maxConcurrency: number | null;
}
/** Queue-wait heat buckets, in milliseconds (docs/05 section 3.2, logarithmic). */
export interface QueueHeatBucket {
    '0-1s': number;
    '1-5s': number;
    '5-30s': number;
    '30s+': number;
}
export interface MinuteHeat {
    readonly atMs: number;
    readonly buckets: QueueHeatBucket;
}
export declare function concurrencyOf(events: readonly MetricsEvent[], nowMs: number, minutes: number): readonly MinuteConcurrency[];
export declare function heatOf(events: readonly MetricsEvent[], nowMs: number, minutes: number): readonly MinuteHeat[];
//# sourceMappingURL=amd-concurrency.d.ts.map