/**
 * AMD usage polling (docs/02 section 1.6; docs/07 A-12..A-14).
 *
 * The response names every quota field `*_usd`, and none of them is a dollar amount:
 * they are pts, the tally the pricing sheet in 02 section 1.7 uses. The types here
 * therefore end in `Pts` and the UI wording is "pts". A "$" must never be printed next
 * to one of these numbers, and that starts by not letting the field name say "usd".
 *
 * `rpm_limit` is 30 -- the per-API-Key platform ceiling. It is NOT the account's 20,
 * which only ever arrives in a response header. Keeping both numbers in one type is how
 * a per-key limit turns into luggage, so UsageResult has no account field at all.
 *
 * The docs never promise that /v1/usage is free of RPM cost themselves, so a poll is
 * treated as a request: the caller budgets it, the default cadence is 5 minutes, and the
 * next poll can never fire sooner than 60s.
 */
import type { UsageResult } from './contract.js';
/** 02 section 1.6: the unknown endpoints are on the same key, so a poll is charged like any call. */
export declare const USAGE_POLL_DEFAULT_MS = 300000;
/** 02 section 1.6: refresh on demand is allowed, but at most once per minute. */
export declare const USAGE_POLL_FLOOR_MS = 60000;
type FetchLike = (url: string, init: {
    readonly headers: Record<string, string>;
}) => Promise<{
    readonly status: number;
    text(): Promise<string>;
}>;
export declare function setUsageTransport(next: FetchLike | null): void;
/** What the poller remembers between ticks: the last full snapshot and when it was seen. */
export interface UsagePollState {
    readonly fetchedAt: string;
    readonly result: UsageResult;
}
/** Parse a /v1/usage body. An unreadable body is unknown, not zero. */
export declare function parseUsageResponse(body: string, fetchedAt: string): UsageResult;
/**
 * GET /v1/usage?include_recent=true.
 *
 * On failure the previous snapshot is returned unchanged except its own `reason`, so the
 * UI keeps showing "8.1588 pts, as of 14:32" next to a an unknown badge instead of
 * blanking the row or, worse, printing a 0 the account does not have. `fetchedAt` on a
 * stale number is the previous fetch time precisely so the UI can say how old it is.
 */
export declare function fetchAmdUsage(key: string, nowMs: number, baseUrl?: string, previous?: UsagePollState): Promise<UsageResult>;
export {};
//# sourceMappingURL=amd-usage.d.ts.map