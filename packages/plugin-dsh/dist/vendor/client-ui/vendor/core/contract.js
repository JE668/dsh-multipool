/**
 * Shared data model (docs/03 sections 1-5) -- the one data shape for the whole repo.
 *
 * Two rules that explain every choice in this file:
 *   1. Source travels with value: anything that reaches UI or a scheduling decision
 *      is Sourced<T>, never a bare value.
 *   2. Missing means null: when upstream does not provide a field it is
 *      {value: null, source: 'unknown'}. Never 0, never '', never -1.
 */
export const PROVIDER_IDS = ['amd', 'nim', 'sensenova', 'agnes', 'google'];
/**
 * Which value wins when two sources disagree about the number used for admission.
 * Display always shows every source side by side; this order only picks the input
 * for the limiter.
 */
export const SOURCE_PRIORITY = [
    'api',
    'doc',
    'doc-local',
    'user',
    'learned',
    'assume',
    'unknown',
];
export function sourceRank(source) {
    const idx = SOURCE_PRIORITY.indexOf(source);
    return idx === -1 ? SOURCE_PRIORITY.length : idx;
}
/** A field upstream never supplied. Renderers may only print "(upstream: not provided)". */
export function unknownValue(raw) {
    return raw === undefined ? { value: null, source: 'unknown' } : { value: null, source: 'unknown', raw };
}
/** An unknown field that needs a human explanation (no endpoint, not published, ...). */
export function unknownSource(note) {
    return note === undefined ? { value: null, source: 'unknown' } : { value: null, source: 'unknown', note };
}
/** 01-PRD 的 429 分类表（docs/03 §4）只有这 8 个值属于限流分类。 */
export const RATE_KINDS = [
    'rpm_key',
    'rpm_ip',
    'concurrency',
    'daily_quota',
    'plan_credit',
    'rate_opaque',
    'auth',
    'model_missing',
];
/** 运输层结果：只用于重试与冷却决策，不得写进 MetricsEvent.rateKind（03 §4）。 */
export const TRANSPORT_KINDS = ['network', 'upstream_5xx', 'client_4xx', 'ok', 'unknown'];
export function isRateKind(value) {
    return RATE_KINDS.includes(value);
}
//# sourceMappingURL=contract.js.map