/**
 * Shared data model (docs/03 sections 1-5) -- the one data shape for the whole repo.
 *
 * Two rules that explain every choice in this file:
 *   1. Source travels with value: anything that reaches UI or a scheduling decision
 *      is Sourced<T>, never a bare value.
 *   2. Missing means null: when upstream does not provide a field it is
 *      {value: null, source: 'unknown'}. Never 0, never '', never -1.
 */

export type ProviderId = 'amd' | 'nim' | 'sensenova' | 'agnes' | 'google'

export const PROVIDER_IDS: readonly ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

export type Source =
  | 'api'
  | 'doc'
  | 'doc-local'
  | 'learned'
  | 'user'
  | 'assume'
  | 'unknown'

/**
 * Which value wins when two sources disagree about the number used for admission.
 * Display always shows every source side by side; this order only picks the input
 * for the limiter.
 */
export const SOURCE_PRIORITY: readonly Source[] = [
  'api',
  'doc',
  'doc-local',
  'user',
  'learned',
  'assume',
  'unknown',
]

export function sourceRank(source: Source): number {
  const idx = SOURCE_PRIORITY.indexOf(source)
  return idx === -1 ? SOURCE_PRIORITY.length : idx
}

export interface Sourced<T = unknown> {
  readonly value: T | null
  readonly source: Source
  readonly ref?: string
  readonly note?: string
  readonly ambiguous?: boolean
  readonly raw?: string
  readonly fetchedAt?: string
}

/** A field upstream never supplied. Renderers may only print "(upstream: not provided)". */
export function unknownValue<T = unknown>(raw?: string): Sourced<T> {
  return raw === undefined ? { value: null, source: 'unknown' } : { value: null, source: 'unknown', raw }
}

/** An unknown field that needs a human explanation (no endpoint, not published, ...). */
export function unknownSource<T = unknown>(note?: string): Sourced<T> {
  return note === undefined ? { value: null, source: 'unknown' } : { value: null, source: 'unknown', note }
}

export type Modality = string

export type Stability = 'stable' | 'beta' | 'unstable' | 'experimental'

export type AgnesTier = 'free' | 'lite' | 'plus' | 'pro' | 'max'

/**
 * Every rate-limit outcome the scheduler knows how to handle.
 * The first eight come from docs/03 section 4 and docs/02 section 1.4.
 * They are the only values that may be stored on a MetricsEvent or drawn on a chart.
 * The trailing five (network / upstream_5xx / client_4xx / ok / unknown) are transport
 * outcomes: they steer retry and cooldown, and must never reach the rate-limit panels.
 */
export type RateKind =
  | 'rpm_key'
  | 'rpm_ip'
  | 'concurrency'
  | 'daily_quota'
  | 'plan_credit'
  | 'rate_opaque'
  | 'auth'
  | 'model_missing'
  | 'network'
  | 'upstream_5xx'
  | 'client_4xx'
  | 'ok'
  | 'unknown'

export type RateClass = RateKind

/** Transport-level outcomes. Same union for now; kept as a distinct name so panels can type against RateKind only. */
export type TransportKind = RateKind

export type AccountStatus =
  | 'available'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'quota_unknown'
  | 'auth_failed'
  | 'disabled'
  | 'rejected_key'

export interface AccountLimits {
  readonly rpmAccount?: Sourced<number>
  readonly dailyQuota?: Sourced<number>
  readonly planTier?: Sourced<AgnesTier>
}

export interface Account {
  readonly providerId: ProviderId
  readonly accountAlias: string
  readonly keyIdMasked: string
  readonly enabled: boolean
  readonly limits: AccountLimits
  readonly status: AccountStatus
  /** Epoch ms (absolute). Absolute instants drift when the system clock zone changes; display only. */
  readonly coolUntil?: number
  /** cooldownReason: same meaning as a Retry-After class. Prefer it over a locally invented curve. */
  readonly cooldownReason?: RateKind
  readonly lastSeenAt?: string
}

export type CapabilityKey = 'tools' | 'vision' | 'reasoning' | 'jsonMode' | 'structuredOutputs'

export interface NormalizedPricing {
  readonly prompt?: Sourced<string>
  readonly completion?: Sourced<string>
  readonly inputCacheRead?: Sourced<string>
  readonly perCharPrompt?: Sourced<string>
  readonly pricingUnit?: 'tokens' | 'chars'
}

export type NormalizedModel = {
  readonly providerId: ProviderId
  readonly id: string
  readonly displayName?: string
  readonly family?: Sourced<string>
  readonly contextLength?: Sourced<number>
  readonly maxOutput?: Sourced<number>
  readonly inputModalities?: Sourced<Modality[]>
  readonly outputModalities?: Sourced<Modality[]>
  readonly supportedParameters?: Sourced<string[]>
  readonly capabilities?: Partial<Record<CapabilityKey, Sourced<boolean>>>
  readonly reasoningLevels?: Sourced<string[]> | null
  /** AMD: decimal strings, per-token, never floats. */
  readonly pricing?: NormalizedPricing | null
  readonly stability?: Sourced<Stability>
  /** AMD only: zero daily-quota cost per docs/02 section 1.7. Never implies "no quota slot". */
  readonly free?: Sourced<boolean>
  readonly conflicts?: ConflictRecord[]
  readonly fetchedAt: string
  readonly staleSince?: string
  readonly catalogSource?: 'api' | 'bundled' | 'merged'
  /** AMD: free !== true implies pts cost. A missing field must not be inferred as free. */
  readonly costGuard?: boolean
}

export interface ConflictValue {
  readonly value: unknown
  readonly source: Source
  readonly ref?: string
}

export interface ConflictRecord {
  readonly field: string
  readonly values: ConflictValue[]
  readonly resolved?: { readonly value: unknown; readonly by: 'api' | 'user' | 'manual'; readonly ref: string }
}

export interface AdapterResponse {
  readonly status: number
  /** Header names are compared case-insensitively by adapters. */
  readonly headers: Readonly<Record<string, string>>
  /** Raw text, never discarded. Adapters unwrap it in classify(); callers keep the bytes. */
  readonly body: string
}

export interface HeaderSnapshot {
  readonly rpmLimit?: Sourced<number>
  readonly rpmRemaining?: Sourced<number>
  /** Relative milliseconds until window reset, never an absolute epoch. */
  readonly resetInMs?: Sourced<number>
  /** NOTE: the three "-USD" headers carry pts, not dollars. No currency symbol anywhere. */
  readonly dailyLimitPts?: Sourced<number>
  readonly dailyUsedPts?: Sourced<number>
  readonly dailyRemainingPts?: Sourced<number>
  readonly dailyResetInMs?: Sourced<number>
  readonly raw: Readonly<Record<string, string>>
}

export interface ModelCatalogResult {
  readonly ok: boolean
  readonly models: NormalizedModel[]
  readonly fetchedAt: string
  readonly error?: string
}

export interface UsageResult {
  readonly available: boolean
  readonly reason?: 'no-endpoint' | 'failed'
  /** KEY-level rpm_limit from /v1/usage. Never the account-level 20. */
  readonly rpmLimit?: Sourced<number>
  readonly dailyLimitPts?: Sourced<number>
  readonly dailyUsedPts?: Sourced<number>
  readonly dailyRemainingPts?: Sourced<number>
  readonly dailyResetAt?: Sourced<string>
  readonly fetchedAt?: string
}

export interface Backoff {
  readonly waitMs: number
  readonly jitterMs: number
}

export interface ProviderAdapter {
  readonly id: ProviderId
  classify(res: AdapterResponse): RateClass
  fetchModels(key: string): Promise<ModelCatalogResult>
  fetchUsage?(key: string): Promise<UsageResult>
  readHeaders?(res: AdapterResponse): HeaderSnapshot | null
  backoffPolicy(rc: RateClass, attempt: number): Backoff
}
