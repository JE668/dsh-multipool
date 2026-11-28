/**
 * Google Gemini adapter (docs/06 T-8-a, T-8-b, T-8-c, T-8-d, T-8-e; catalog/limits.json google).
 *
 * keyPrefix=AIza（真实 Key 以 AIza 开头，紧跟 35 位 base64url，约 39 字符）。
 * 鉴权：REST 用 x-goog-api-key，OpenAI 兼容端点用 Authorization: Bearer；查询串 ?key= 被禁止。
 * 模型 ID 形状：models/<id>（原生端点），OpenAI 兼容端点 model 不带前缀。前缀拼接/剥离只在适配器内部。
 * Provider 级无单一 RPM：按模型取值，见 freeTier.modelLimits[*].
 * dailyQuota 按模型 rpd；quotaTimezone=America/Los_Angeles。
 * 无用量端点。
 */
import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass } from './contract.js';
export declare const GOOGLE_KEY_PREFIX = "AIza";
export declare const GOOGLE_QUOTA_TIMEZONE = "America/Los_Angeles";
export declare function classifyGoogle(res: AdapterResponse): RateClass | null;
export declare function classifyGoogleTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown';
export declare function googleBackoff(rc: RateClass, attempt: number): Backoff;
export declare function googleReadHeaders(res: AdapterResponse): HeaderSnapshot | null;
export declare const GOOGLE_FETCH_USAGE: undefined;
export declare function googleEmptyCatalog(): {
    ok: true;
    models: [];
    fetchedAt: string;
};
/** Strip `models/` prefix from native Google model IDs for OpenAI-compat endpoints. */
export declare function stripModelsPrefix(modelId: string): string;
/** Add `models/` prefix for native Google endpoints. */
export declare function addModelsPrefix(modelId: string): string;
//# sourceMappingURL=google-adapter.d.ts.map