/**
 * Google model catalog (docs/06 T-8-b; catalog/limits.json google).
 *
 * Google's native endpoint returns models with `name` like "models/gemini-4-hydrogen".
 * The OpenAI-compat endpoint returns IDs without the prefix. The adapter strips/adds
 * the prefix internally -- callers see unprefixed IDs.
 *
 * Google does not publish a single provider-level RPM: each model has its own
 * limits in freeTier.modelLimits / liveModelLimits. Those live in catalog/limits.json
 * and are read by the host, not by this file.
 *
 * No usage endpoint: dailyQuota remains unknown (docs/07 H-10).
 */
import type { ModelCatalogResult, NormalizedModel } from './contract.js';
/** 02 §1.5 default cadence for a refresh, shared with AMD catalog. */
export declare const CATALOG_REFRESH_MS = 600000;
/** One raw Google catalog entry -> NormalizedModel. Absent fields stay absent. */
export declare function normalizeGoogleModel(raw: Record<string, unknown>, nowIso: string): NormalizedModel | null;
/** Parse Google's catalog body into NormalizedModel[]. Empty/unreadable body yields []. */
export declare function parseGoogleCatalogResponse(body: string): NormalizedModel[];
/** Every entry of a loose list -> NormalizedModel[]. Google-specific parser. */
export declare function normalizeGoogleModels(list: readonly unknown[]): NormalizedModel[];
/**
 * GET models through the injected clock only (Z-03: no bare Date.now).
 *
 * Cache hit inside CATALOG_REFRESH_MS returns the previous snapshot without touching
 * the socket. A failed refresh keeps the old snapshot with staleSince stamped.
 */
export declare function fetchGoogleCatalog(key: string, nowMs: number, baseUrl?: string, transport?: (url: string, init: {
    readonly headers: Record<string, string>;
}) => Promise<{
    readonly status: number;
    text(): Promise<string>;
}>): Promise<ModelCatalogResult>;
/** Tests only: drop every cached snapshot. */
export declare function resetGoogleCatalogCache(): void;
//# sourceMappingURL=google-catalog.d.ts.map