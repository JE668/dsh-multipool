/**
 * SenseNova adapter (docs/06 T-4-a, T-4-b, T-4-c, T-4-d; catalog/limits.json sensenova).
 *
 * 三份一手资料全文 0 命中 RPM/TPM/QPS/Retry-After：不得引入任何未经确认的数值。
 * admitRpm=3(assume) 是初始保守值，运行后按 429 率 AIMD 调整；admitRpmHardCap=30(assume) 是升速封顶。
 * 无用量端点：usageEndpoint=null，fetchUsage 返回 undefined。
 * 配额池：窗口5h=120000 pts，窗口周=1200000 pts（doc-local，来自 SenseNova-API-文档整理.md）。
 */
import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass } from './contract.js';
export declare const SENSENOVA_ADMIT_RPM = 3;
export declare const SENSENOVA_ADMIT_RPM_HARD_CAP = 30;
export declare const SENSENOVA_BACKOFF_START_MS = 30000;
export declare const SENSENOVA_BACKOFF_MAX_MS = 300000;
export declare const SENSENOVA_BACKOFF_DECELERATE = 0.5;
export declare const SENSENOVA_SLOWDOWN_COOLDOWN_MS = 300000;
export declare const SENSENOVA_MIGRATE_AFTER_CONSECUTIVE_429 = 3;
/** Classify a SenseNova response into a RateClass (or null when not rate-limited). */
export declare function classifySensenova(res: AdapterResponse): RateClass | null;
/** Transport outcome for one SenseNova response. */
export declare function classifySensenovaTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown';
/** Backoff policy for SenseNova (catalog values). */
export declare function sensenovaBackoff(rc: RateClass, attempt: number): Backoff;
/** Read rate-limit headers from a SenseNova response. No such headers documented → null. */
export declare function sensenovaReadHeaders(res: AdapterResponse): HeaderSnapshot | null;
/** SenseNova has no usage endpoint → fetchUsage returns undefined. */
export declare const SENSENOVA_FETCH_USAGE: undefined;
/** SenseNova model catalog result (empty until a real catalog endpoint is wired). */
export declare function sensenovaEmptyCatalog(): {
    ok: true;
    models: [];
    fetchedAt: string;
};
//# sourceMappingURL=sensenova-adapter.d.ts.map