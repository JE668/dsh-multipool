/**
 * Metrics storage: docs/06 T-1-h, event collection plus retention.
 *
 * A MetricsEvent carries counters and identifiers, never the text of a request --
 * no messages, no prompt, no Authorization value. D-02 asserts exactly that on the
 * serialized form, so the type here must never grow a field that could hold a body.
 *
 * Two lifetimes, per 03 section 3.4:
 *   events  -- thirty days, then gone (D-01: day 1 clears, days 2..31 survive)
 *   rollups -- one per finished day, kept forever
 *
 * ts is milliseconds since the epoch, matching what contract.ts already declares.
 */
import { pointsFor } from './pricing.js';
/** 03 section 3.4: events live thirty days. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
/** Asia/Shanghai is UTC+8 with no daylight saving, so the offset is a constant. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
/** Days tick over at Shanghai midnight, the same boundary AMD bills against. */
export function shanghaiDayKey(ms) {
    return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}
export function rollupOf(events, priceOf) {
    const byKey = new Map();
    for (const event of events) {
        const key = `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}`;
        let rollup = byKey.get(key);
        if (rollup === undefined) {
            rollup = {
                requests: 0,
                errors: 0,
                err429: {},
                promptTokens: 0,
                completionTokens: 0,
                reasoningTokens: 0,
                cacheReadTokens: 0,
            };
            byKey.set(key, rollup);
        }
        rollup.requests += 1;
        if (event.status >= 400)
            rollup.errors += 1;
        if (event.status === 429 && event.rateKind !== undefined) {
            rollup.err429[event.rateKind] = (rollup.err429[event.rateKind] ?? 0) + 1;
        }
        rollup.promptTokens += event.promptTokens ?? 0;
        rollup.completionTokens += event.completionTokens ?? 0;
        rollup.reasoningTokens += event.reasoningTokens ?? 0;
        rollup.cacheReadTokens += event.cacheReadTokens ?? 0;
    }
    const out = new Map();
    for (const [key, counters] of byKey) {
        const heads = events.filter((event) => `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}` === key);
        const first = heads[0];
        if (first === undefined)
            continue;
        out.set(key, {
            date: shanghaiDayKey(first.ts),
            providerId: first.providerId,
            accountAlias: first.accountAlias,
            requests: counters.requests,
            errors: counters.errors,
            err429: { ...counters.err429 },
            promptTokens: counters.promptTokens,
            completionTokens: counters.completionTokens,
            reasoningTokens: counters.reasoningTokens,
            cacheReadTokens: counters.cacheReadTokens,
            // 03 section 3.4: null unless a price source exists. Zero would read as free.
            estimatedCostPts: sumPoints(events, key, priceOf),
        });
    }
    return out;
}
/**
 * Total pts for the events behind one rollup key, or null when the price is unknown.
 * Null propagates rather than skipping unpriced events: a partial total would look like
 * a cheaper day than it was, and a readout that under-reports a quota invites a 429.
 */
function sumPoints(events, key, priceOf) {
    if (priceOf === undefined)
        return null;
    const owned = events.filter((event) => `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}` === key);
    if (owned.length === 0)
        return null;
    let total = 0;
    for (const event of owned) {
        const price = priceOf(event.modelId);
        if (price === null)
            return null;
        const points = pointsFor(price, {
            promptTokens: event.promptTokens ?? 0,
            completionTokens: event.completionTokens ?? 0,
            reasoningTokens: event.reasoningTokens,
            cacheReadTokens: event.cacheReadTokens,
        });
        if (points === null)
            return null;
        const value = Number(points);
        if (!Number.isFinite(value))
            return null;
        total += value;
    }
    return total;
}
/**
 * In-memory store. Events roll off after RETENTION_MS; each day that rolls off is
 * folded into one DailyRollup per (day, provider, account) and kept for good.
 *
 * Rolling is the caller's, not a timer's: append only records, prune folds whatever has
 * aged out against the nowMs it is given. Doing it inside append would judge an event by
 * its own timestamp, so replaying thirty-one days of fixtures would fold each day the
 * instant it arrived and leave a single rollup standing.
 */
export function createMetricsStore(clock, priceOf) {
    let kept = [];
    const rollups = new Map();
    function fold(expired) {
        const byKey = rollupOf(expired, priceOf);
        for (const [key, rollup] of byKey) {
            const prior = rollups.get(key);
            if (prior === undefined) {
                rollups.set(key, rollup);
                continue;
            }
            const merged = { ...prior.err429 };
            for (const [kind, count] of Object.entries(rollup.err429)) {
                merged[kind] = (merged[kind] ?? 0) + count;
            }
            rollups.set(key, {
                ...prior,
                requests: prior.requests + rollup.requests,
                errors: prior.errors + rollup.errors,
                err429: merged,
                promptTokens: prior.promptTokens + rollup.promptTokens,
                completionTokens: prior.completionTokens + rollup.completionTokens,
                reasoningTokens: prior.reasoningTokens + rollup.reasoningTokens,
                cacheReadTokens: prior.cacheReadTokens + rollup.cacheReadTokens,
                estimatedCostPts: sumPoints(expired, key, priceOf),
            });
        }
    }
    function prune(nowMs) {
        const floor = nowMs - RETENTION_MS;
        const fresh = [];
        const expired = [];
        for (const event of kept) {
            void clock;
            (event.ts < floor ? expired : fresh).push(event);
        }
        if (expired.length > 0)
            fold(expired);
        kept = fresh;
    }
    return {
        append(event) {
            kept.push(event);
        },
        prune(nowMs) {
            prune(nowMs);
        },
        events() {
            return kept;
        },
        rollups() {
            return [...rollups.values()];
        },
    };
}
//# sourceMappingURL=metrics.js.map