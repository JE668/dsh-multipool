/**
 * Shared data model (docs/03 sections 1-5) -- the one data shape for the whole repo.
 *
 * Two rules that explain every choice in this file:
 *   1. Source travels with value: anything that reaches UI or a scheduling decision
 *      is Sourced<T>, never a bare value.
 *   2. Missing means null: when upstream does not provide a field it is
 *      {value: null, source: 'unknown'}. Never 0, never '', never -1.
 */
export type ProviderId = 'amd' | 'nim' | 'sensenova' | 'agnes' | 'google';
export declare const PROVIDER_IDS: readonly ProviderId[];
export type Source = 'api' | 'doc' | 'doc-local' | 'learned' | 'user' | 'assume' | 'unknown';
/**
 * Which value wins when two sources disagree about the number used for admission.
 * Display always shows every source side by side; this order only picks the input
 * for the limiter.
 */
export declare const SOURCE_PRIORITY: readonly Source[];
export declare function sourceRank(source: Source): number;
export interface Sourced<T = unknown> {
    readonly value: T | null;
    readonly source: Source;
    readonly ref?: string;
    readonly note?: string;
    readonly ambiguous?: boolean;
    readonly raw?: string;
    readonly fetchedAt?: string;
}
/** A field upstream never supplied. Renderers may only print "(upstream: not provided)". */
export declare function unknownValue<T = unknown>(raw?: string): Sourced<T>;
/** An unknown field that needs a human explanation (no endpoint, not published, ...). */
export declare function unknownSource<T = unknown>(note?: string): Sourced<T>;
export type Modality = string;
export type Stability = 'stable' | 'beta' | 'unstable' | 'experimental';
export type AgnesTier = 'free' | 'lite' | 'plus' | 'pro' | 'max';
/**
 * The eight rate-limit outcomes the scheduler knows how to handle (docs/03 §4).
 * They are the only values that may be stored on MetricsEvent.rateKind or drawn on a panel.
 * Transport outcomes live in TransportKind: they steer retry and cooldown, never a panel.
 */
export type RateKind = 'rpm_key' | 'rpm_ip' | 'concurrency' | 'daily_quota' | 'plan_credit' | 'rate_opaque' | 'auth' | 'model_missing';
export type RateClass = RateKind;
/** Transport-level outcomes. Disjoint from RateKind so a panel cannot draw one by accident. */
export type TransportKind = 'network' | 'upstream_5xx' | 'client_4xx' | 'ok' | 'unknown';
export type AccountStatus = 'available' | 'rate_limited' | 'quota_exhausted' | 'quota_unknown' | 'auth_failed' | 'disabled' | 'rejected_key';
export interface AccountLimits {
    readonly rpmAccount?: Sourced<number>;
    readonly dailyQuota?: Sourced<number>;
    readonly planTier?: Sourced<AgnesTier>;
}
export interface Account {
    readonly providerId: ProviderId;
    readonly accountAlias: string;
    readonly keyIdMasked: string;
    readonly enabled: boolean;
    readonly limits: AccountLimits;
    readonly status: AccountStatus;
    /** Epoch ms (absolute). Absolute instants drift when the system clock zone changes; display only. */
    readonly coolUntil?: number;
    /** cooldownReason: same meaning as a Retry-After class. Prefer it over a locally invented curve. */
    readonly cooldownReason?: RateKind;
    readonly lastSeenAt?: string;
}
export type CapabilityKey = 'tools' | 'vision' | 'reasoning' | 'jsonMode' | 'structuredOutputs';
export interface NormalizedPricing {
    readonly prompt?: Sourced<string>;
    readonly completion?: Sourced<string>;
    readonly inputCacheRead?: Sourced<string>;
    readonly perCharPrompt?: Sourced<string>;
    readonly pricingUnit?: 'tokens' | 'chars';
}
export type NormalizedModel = {
    readonly providerId: ProviderId;
    readonly id: string;
    readonly displayName?: string;
    readonly family?: Sourced<string>;
    readonly contextLength?: Sourced<number>;
    readonly maxOutput?: Sourced<number>;
    readonly inputModalities?: Sourced<Modality[]>;
    readonly outputModalities?: Sourced<Modality[]>;
    readonly supportedParameters?: Sourced<string[]>;
    readonly capabilities?: Partial<Record<CapabilityKey, Sourced<boolean>>>;
    readonly reasoningLevels?: Sourced<string[]> | null;
    /** AMD: decimal strings, per-token, never floats. */
    readonly pricing?: NormalizedPricing | null;
    readonly stability?: Sourced<Stability>;
    /** AMD only: zero daily-quota cost per docs/02 section 1.7. Never implies "no quota slot". */
    readonly free?: Sourced<boolean>;
    readonly conflicts?: ConflictRecord[];
    readonly fetchedAt: string;
    readonly staleSince?: string;
    readonly catalogSource?: 'api' | 'bundled' | 'merged';
    /** AMD: free !== true implies pts cost. A missing field must not be inferred as free. */
    readonly costGuard?: boolean;
};
export interface ConflictValue {
    readonly value: unknown;
    readonly source: Source;
    readonly ref?: string;
}
export interface ConflictRecord {
    readonly field: string;
    readonly values: ConflictValue[];
    readonly resolved?: {
        readonly value: unknown;
        readonly by: 'api' | 'user' | 'manual';
        readonly ref: string;
    };
}
export interface AdapterResponse {
    readonly status: number;
    /** Header names are compared case-insensitively by adapters. */
    readonly headers: Readonly<Record<string, string>>;
    /** Raw text, never discarded. Adapters unwrap it in classify(); callers keep the bytes. */
    readonly body: string;
}
export interface HeaderSnapshot {
    readonly rpmLimit?: Sourced<number>;
    readonly rpmRemaining?: Sourced<number>;
    /** Relative milliseconds until window reset, never an absolute epoch. */
    readonly resetInMs?: Sourced<number>;
    /** NOTE: the three "-USD" headers carry pts, not dollars. No currency symbol anywhere. */
    readonly dailyLimitPts?: Sourced<number>;
    readonly dailyUsedPts?: Sourced<number>;
    readonly dailyRemainingPts?: Sourced<number>;
    readonly dailyResetInMs?: Sourced<number>;
    readonly raw: Readonly<Record<string, string>>;
}
export interface ModelCatalogResult {
    readonly ok: boolean;
    readonly models: NormalizedModel[];
    readonly fetchedAt: string;
    readonly error?: string;
    /**
     * Set when a refresh failed and the previous snapshot is being served. Absent means
     * the list was fetched at fetchedAt (02 §1.7). Never a substitute for an empty list:
     * a caller that sees staleSince must also see the old models, and the UI must say
     * "this is the 2026-11-17 snapshot" rather than pretend the fetch worked.
     */
    readonly staleSince?: string;
}
export interface UsageResult {
    readonly available: boolean;
    readonly reason?: 'no-endpoint' | 'failed';
    /** KEY-level rpm_limit from /v1/usage. Never the account-level 20. */
    readonly rpmLimit?: Sourced<number>;
    readonly dailyLimitPts?: Sourced<number>;
    readonly dailyUsedPts?: Sourced<number>;
    readonly dailyRemainingPts?: Sourced<number>;
    readonly dailyResetAt?: Sourced<string>;
    readonly fetchedAt?: string;
}
export interface Backoff {
    readonly waitMs: number;
    readonly jitterMs: number;
}
export interface ProviderAdapter {
    readonly id: ProviderId;
    classify(res: AdapterResponse): RateClass;
    fetchModels(key: string): Promise<ModelCatalogResult>;
    fetchUsage?(key: string): Promise<UsageResult>;
    readHeaders?(res: AdapterResponse): HeaderSnapshot | null;
    backoffPolicy(rc: RateClass, attempt: number): Backoff;
}
/** 01-PRD 的 429 分类表（docs/03 §4）只有这 8 个值属于限流分类。 */
export declare const RATE_KINDS: readonly RateKind[];
/** 运输层结果：只用于重试与冷却决策，不得写进 MetricsEvent.rateKind（03 §4）。 */
export declare const TRANSPORT_KINDS: readonly TransportKind[];
export declare function isRateKind(value: string): value is RateKind;
/** AMD 三种错误壳（02 §1.4）+ Anthropic 壳 + 非 JSON 体（HTML / 空）。 */
export type ErrorShell = 'top-level' | 'detail' | 'detail-error' | 'anthropic' | 'html' | 'empty' | 'unparsable';
/**
 * 解析后的错误体。
 * `message` / `code` / `type` 缺就是 null —— 从不用空串或占位文本冒充上游原话。
 */
export interface ParsedError {
    readonly shell: ErrorShell;
    readonly message: string | null;
    readonly code: string | null;
    readonly type: string | null;
    readonly json: Record<string, unknown> | null;
    /** true = 非空 body 读不出任何一种已记录的壳（diagnostics 必须保留原文，Z-07）。 */
    readonly untrusted: boolean;
}
/** 每次上游调用之后落库的事件（03 §3.4）；不含请求正文（07 D-02）。 */
/**
 * docs/03-DATA-CONTRACT.md section 3.4: one finished day, per provider and account.
 * Optional modelId narrows it to a model; readouts that need a model pass one.
 * Kept "forever": requests/errors are totals and cost is null unless priced, so
 * this survives the decade the events do not.
 */
export interface DailyRollup {
    /** 'YYYY-MM-DD', in Asia/Shanghai (UTC+8), the boundary AMD bills against. */
    readonly date: string;
    readonly providerId: ProviderId;
    readonly accountAlias: string;
    readonly modelId?: string;
    readonly requests: number;
    readonly errors: number;
    /** 429s per rate class; 03 says Partial<Record<RateKind, number>>. */
    readonly err429: Partial<Record<RateKind, number>>;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly reasoningTokens: number;
    readonly cacheReadTokens: number;
    /** Null when no price is known: aggregating nulls as 0 would under-report cost. */
    readonly estimatedCostPts: number | null;
}
export interface MetricsEvent {
    ts: number;
    providerId: ProviderId;
    accountAlias: string;
    keyIdMasked: string;
    modelId: string;
    requestId: string;
    status: number;
    latencyMs: number;
    attempt: number;
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    rateKind?: RateKind;
    queueWaitMs?: number | null;
    concurrencyAtSend?: number | null;
}
//# sourceMappingURL=contract.d.ts.map