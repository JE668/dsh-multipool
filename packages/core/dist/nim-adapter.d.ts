/**
 * NVIDIA NIM adapter (docs/06 T-5-a; catalog/limits.json nim).
 *
 * rpm=40(user)，concurrency=6(assume)，admitRpm=34(assume = 40×0.85)。
 * 用量端点：无（usageEndpoint=null，"no-endpoint"）。
 * 模型目录：公开端点，无鉴权也返回 200，但不得用作配额探针。
 * 跨 Key 迁移：429 时不迁移（crossKeyMigrationOn429=false）。
 */
import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass } from './contract.js';
export declare const NIM_RPM = 40;
export declare const NIM_CONCURRENCY = 6;
export declare const NIM_ADMIT_RPM = 34;
export declare function classifyNim(res: AdapterResponse): RateClass | null;
export declare function classifyNimTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown';
export declare function nimBackoff(rc: RateClass, attempt: number): Backoff;
export declare function nimReadHeaders(res: AdapterResponse): HeaderSnapshot | null;
export declare const NIM_FETCH_USAGE: undefined;
export declare function nimEmptyCatalog(): {
    ok: true;
    models: [];
    fetchedAt: string;
};
//# sourceMappingURL=nim-adapter.d.ts.map