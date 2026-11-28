/**
 * Agnes-AI adapter (docs/06 T-5-b; catalog/limits.json agnes).
 *
 * planTier=free(user)，tiers.free.textRpm=20(doc)。
 * limits: rpm=20(doc)，admitRpm=17(assume = 20×0.85)，concurrency=8(assume)。
 * creditsPerUsd=6600(doc-local，UI 旁必须带 ≈ 与（待校准）)。
 * 无用量端点。
 */
export const AGNES_RPM = 20;
export const AGNES_ADMIT_RPM = 17;
export const AGNES_CONCURRENCY = 8;
export const AGNES_CREDITS_PER_USD = 6600;
function parseAgnesError(body) {
    try {
        const json = JSON.parse(body);
        if (json && typeof json === 'object' && 'error' in json && json.error !== null && typeof json.error === 'object') {
            const err = json.error;
            return {
                message: typeof err.message === 'string' ? err.message : null,
                code: typeof err.code === 'string' ? err.code : null,
            };
        }
    }
    catch {
        // not JSON
    }
    return { message: null, code: null };
}
export function classifyAgnes(res) {
    if (res.status === 429)
        return 'rate_opaque';
    if (res.status === 402)
        return 'plan_credit'; // Agnes 免费档额度用尽
    if (res.status === 401 || res.status === 403)
        return 'auth';
    if (res.status === 400) {
        const parsed = parseAgnesError(res.body);
        if (parsed.message !== null && /model/i.test(parsed.message))
            return 'model_missing';
    }
    return null;
}
export function classifyAgnesTransport(res) {
    if (res.status >= 200 && res.status < 300)
        return 'ok';
    if (res.status >= 500)
        return 'upstream_5xx';
    if (res.status === 429)
        return 'unknown';
    if (res.status >= 400)
        return 'client_4xx';
    return 'unknown';
}
export function agnesBackoff(rc, attempt) {
    let waitMs = 2_000 * Math.pow(2, attempt - 1);
    if (waitMs > 60_000)
        waitMs = 60_000;
    const jitterMs = Math.floor(waitMs * 0.3);
    return { waitMs, jitterMs };
}
export function agnesReadHeaders(res) {
    return null;
}
export const AGNES_FETCH_USAGE = undefined;
export function agnesEmptyCatalog() {
    return { ok: true, models: [], fetchedAt: new Date().toISOString() };
}
//# sourceMappingURL=agnes-adapter.js.map