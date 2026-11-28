/**
 * Agnes-AI adapter (docs/06 T-5-b; catalog/limits.json agnes).
 *
 * planTier=free(user)，tiers.free.textRpm=20(doc)。
 * limits: rpm=20(doc)，admitRpm=17(assume = 20×0.85)，concurrency=8(assume)。
 * creditsPerUsd=6600(doc-local，UI 旁必须带 ≈ 与（待校准）)。
 * 无用量端点。
 */
import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass } from './contract.js';
export declare const AGNES_RPM = 20;
export declare const AGNES_ADMIT_RPM = 17;
export declare const AGNES_CONCURRENCY = 8;
export declare const AGNES_CREDITS_PER_USD = 6600;
export declare function classifyAgnes(res: AdapterResponse): RateClass | null;
export declare function classifyAgnesTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown';
export declare function agnesBackoff(rc: RateClass, attempt: number): Backoff;
export declare function agnesReadHeaders(res: AdapterResponse): HeaderSnapshot | null;
export declare const AGNES_FETCH_USAGE: undefined;
export declare function agnesEmptyCatalog(): {
    ok: true;
    models: [];
    fetchedAt: string;
};
//# sourceMappingURL=agnes-adapter.d.ts.map