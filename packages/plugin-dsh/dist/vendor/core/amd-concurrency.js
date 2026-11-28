/**
 * Per-minute folds of the events store that the dashboard draws but does not use for admission:
 * concurrency seen at send time, and queue-wait heat (docs/05 section 3.2).
 *
 * Like amd-trend.ts: a minute with no requests keeps its point, its value is null rather than 0,
 * and nothing here is invented.
 */
import { MINUTE_MS } from './amd-trend.js';
function floorMinute(ms) {
    return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}
function emptyBuckets() {
    return { '0-1s': 0, '1-5s': 0, '5-30s': 0, '30s+': 0 };
}
function bucketOf(queueWaitMs) {
    if (queueWaitMs === undefined || queueWaitMs === null || !isFinite(queueWaitMs) || queueWaitMs < 0)
        return null;
    if (queueWaitMs <= 1_000)
        return '0-1s';
    if (queueWaitMs <= 5_000)
        return '1-5s';
    if (queueWaitMs <= 30_000)
        return '5-30s';
    return '30s+';
}
export function concurrencyOf(events, nowMs, minutes) {
    if (!Number.isInteger(minutes) || minutes < 1)
        return [];
    const lastStart = floorMinute(nowMs);
    const firstStart = lastStart - (minutes - 1) * MINUTE_MS;
    const max = new Array(minutes).fill(0);
    const seen = new Array(minutes).fill(false);
    for (const event of events) {
        if (event.ts < firstStart || event.ts >= lastStart + MINUTE_MS)
            continue;
        const at = Math.floor((event.ts - firstStart) / MINUTE_MS);
        const c = event.concurrencyAtSend;
        if (typeof c === 'number' && isFinite(c) && c >= 0) {
            seen[at] = true;
            const previous = max[at] ?? 0;
            if (c > previous)
                max[at] = c;
        }
    }
    const out = [];
    for (let at = 0; at < minutes; at += 1) {
        const m = max[at];
        out.push({ atMs: firstStart + at * MINUTE_MS, maxConcurrency: seen[at] ? (m ?? null) : null });
    }
    return out;
}
export function heatOf(events, nowMs, minutes) {
    if (!Number.isInteger(minutes) || minutes < 1)
        return [];
    const lastStart = floorMinute(nowMs);
    const firstStart = lastStart - (minutes - 1) * MINUTE_MS;
    const buckets = new Array(minutes).fill(null).map(() => emptyBuckets());
    const seen = new Array(minutes).fill(false);
    for (const event of events) {
        if (event.ts < firstStart || event.ts >= lastStart + MINUTE_MS)
            continue;
        const at = Math.floor((event.ts - firstStart) / MINUTE_MS);
        const b = bucketOf(event.queueWaitMs);
        if (b !== null) {
            seen[at] = true;
            buckets[at][b] += 1;
        }
    }
    const out = [];
    for (let at = 0; at < minutes; at += 1) {
        out.push({ atMs: firstStart + at * MINUTE_MS, buckets: buckets[at] ?? emptyBuckets() });
    }
    return out;
}
//# sourceMappingURL=amd-concurrency.js.map