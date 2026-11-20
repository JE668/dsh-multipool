/**
 * AMD model catalog (docs/02 §1.7; docs/07 A-09..A-11, A-14).
 *
 * Two official facts shape this file more than the payload shape does:
 *   1. "Listing models does not take a concurrency slot, but it does count against
 *      the per-minute limit" -- so every refresh goes through the same budget as a
 *      chat call, serially, and a 10 minute cache is the default rather than an
 *      optimisation.
 *   2. The list is identical for every API Key on the account, so it is cached per
 *      provider, not per Key.
 *
 * The payload is a bare {data: [...]} with no `object`, no `owned_by`, no `created`.
 * A parser that requires an OpenAI-shaped wrapper would report an empty catalog for
 * a perfectly good gateway, so nothing here treats those absent fields as errors.
 */
import type { ModelCatalogResult, NormalizedModel } from './contract.js';
/** 02 §1.5 default cadence for a refresh, and 03 §8's floor of the same number. */
export declare const CATALOG_REFRESH_MS = 600000;
/** One raw catalog entry -> NormalizedModel. An absent field stays absent: never 0, never false. */
export declare function normalizeModel(raw: Record<string, unknown>, nowIso: string): NormalizedModel | null;
/** Parse the raw gateway body into model records. An empty or unreadable body yields []. */
export declare function parseCatalogResponse(body: string): NormalizedModel[];
/** Every entry of a loose list -> NormalizedModel[]. Free semantics live in one place: below. */
export declare function normalizeModels(list: readonly unknown[], providerId: string): NormalizedModel[];
/**
 * GET /v1/models through the injected clock only (Z-03: no bare Date.now here).
 *
 * A cache hit inside CATALOG_REFRESH_MS returns the previous snapshot without touching
 * the socket. A failed refresh is NOT a failure of the whole catalog: keep the old
 * snapshot, stamp staleSince on it hungover, and report ok=true so the caller can keep
 * serving -- 07 A-14 says a refresh costs RPM, and spending it to end up with nothing is
 * the worst trade available.
 */
export declare function fetchCatalog(key: string, nowMs: number, baseUrl?: string): Promise<ModelCatalogResult>;
/** Tests only: drop every cached snapshot so cadence arithmetic starts from zero. */
export declare function resetCatalogCache(): void;
/** No real HTTP client lives in core: callers inject one so tests never touch the network. */
export type FetchLike = (url: string, init: {
    readonly headers: Record<string, string>;
}) => Promise<{
    readonly status: number;
    text(): Promise<string>;
}>;
export declare function setCatalogTransport(next: FetchLike | null): void;
//# sourceMappingURL=amd-catalog.d.ts.map