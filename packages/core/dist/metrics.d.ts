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
import type { Clock } from './clock.js';
import { type PriceInMillion } from './pricing.js';
import type { DailyRollup, MetricsEvent } from './contract.js';
/** 03 section 3.4: events live thirty days. */
export declare const RETENTION_MS: number;
/** Days tick over at Shanghai midnight, the same boundary AMD bills against. */
export declare function shanghaiDayKey(ms: number): string;
export interface MetricsStore {
    /** Record one finished request. Events older than the window are dropped. */
    append(event: MetricsEvent): void;
    /** Fold day-entries that have aged out, and drop their events. */
    prune(nowMs: number): void;
    /** Cockpit-facing reads; both are windows, never the whole history. */
    events(): readonly MetricsEvent[];
    rollups(): readonly DailyRollup[];
}
export declare function rollupOf(events: readonly MetricsEvent[], priceOf?: PriceLookup): Map<string, DailyRollup>;
/** Where a pts price comes from; undefined means "no price table", not "free". */
export type PriceLookup = (modelId: string) => PriceInMillion | null;
/**
 * In-memory store. Events roll off after RETENTION_MS; each day that rolls off is
 * folded into one DailyRollup per (day, provider, account) and kept for good.
 *
 * Rolling is the caller's, not a timer's: append only records, prune folds whatever has
 * aged out against the nowMs it is given. Doing it inside append would judge an event by
 * its own timestamp, so replaying thirty-one days of fixtures would fold each day the
 * instant it arrived and leave a single rollup standing.
 */
export declare function createMetricsStore(clock: Clock, priceOf?: PriceLookup): MetricsStore;
//# sourceMappingURL=metrics.d.ts.map