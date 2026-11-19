/**
 * Host -> Client read-only snapshot (06 T-2-a, docs/05 sections  Lois 2 and 3).
 *
 * The client half of the plugin cannot reach the host's key store, the account gate
 * or the metrics store. It gets one plain JSON object per refresh and renders it.
 * That object is built here, in core, so that the one rule that matters -- nothing
 * leaves the host with a whole key in it -- is enforced in one place and tested
 * with a unit test rather than trusted to every caller.
 *
 * Every number carries its Sourced provenance through unchanged (docs/00 rule 2).
 * This layer aggregates and stamps; it never invents a value to fill a gap, and
 * it never turns "no endpoint" into 0.
 */

import type {
  Account,
  AccountStatus,
  MetricsEvent,
  ProviderId,
  RateKind,
  Sourced,
  UsageResult,
} from './contract.js'
import { scrubSecrets } from './secret.js'


/** An account as the client sees it: no secret, and unmasked fields left out. */
export interface ClientAccount {
  readonly providerId: ProviderId
  readonly accountAlias: string
  readonly keyIdMasked: string
  readonly enabled: boolean
  readonly status: AccountStatus
  readonly coolUntil?: number
  readonly cooldownReason?: RateKind
}

/** available / total, the two numbers the sidebar badge is allowed to show. */
export interface AccountTally {
  readonly available: number
  readonly total: number
}

/**
 * The only counts the badge is allowed to make up. Providers with no account are
 * `0 / 0` and rendered grey -- deliberately not `1 / 0` or `-`.
 */
export interface ProviderTally extends AccountTally {
  /** ALL_PROVIDERS when this tally covers the whole pool. */
  readonly providerId: ProviderId
  /** Configured accounts across all providers, so the icon can say grey without a second call. */
  readonly configured: boolean
}

/** One cooling account for the popover's section 3. */
export interface CoolingEntry {
  readonly providerId: ProviderId
  readonly accountAlias: string
  readonly rateKind: RateKind
  readonly untilMs: number
}

export interface SnapshotCounters {
  readonly activeSessions: number
  readonly queued: number
}

/**
 * Float hours-per-second style rate kept as a string: the 429 rate is derived from
 * counters, and docs/00 rule 1 forbids letting a float stand in for a measured value
 * when the value is displayed. The client formats; it does not recompute.
 */
export interface RateWindow {
  readonly requests: number
  readonly err429: number
  /** Null when the window has no requests: 0/0 is not "0 percent", it is "nothing yet". */
  readonly rate: Sourced<string> | null
}

export interface ProviderSnapshot {
  readonly providerId: ProviderId
  readonly tally: AccountTally
  /** Upstream rpm limit as the plugin believes it, plus how much is used right now. */
  readonly rpmUsed?: Sourced<number>
  readonly rpmLimit?: Sourced<number>
  readonly dailyUsedPts?: Sourced<number>
  readonly dailyLimitPts?: Sourced<number>
  /** Upstream reset instant, or null when the provider has no usage endpoint. */
  readonly dailyResetAt?: Sourced<string>
  /**
   * When the upstream usage response was read, as the provider stamped it.
   *
   * Present next to the numbers because today points move during the day: a reading taken at
   * 09:41 is a fact as of 09:41 and not as of now. Stamped from the reading itself, never from
   * the local clock -- the snapshot module has no clock so it cannot quietly become one.
   */
  readonly usageFetchedAt?: string
  readonly usageAvailable: boolean
  /**
   * Provenance of the daily point figures: upstream, or nothing at all.
   *
   * The point numbers are the one field here that cannot be derived from what we were
   * told -- no arithmetic over accounts and events yields them, so a reader cannot tell
   * a miss from a zero by looking. This says which it is. There is deliberately no
   * estimated member: the plugin does not project a day's spend, and a type that allowed
   * one would invite the next writer to fill it in.
   */
  readonly usageSource?: 'api'
  readonly usageUnavailableReason?: string
  readonly err429LastHour: number
  readonly err429ByKind: Readonly<Partial<Record<RateKind, number>>>
}

export interface Snapshot {
  readonly generatedAtMs: number
  readonly accounts: readonly ClientAccount[]
  readonly providers: readonly ProviderSnapshot[]
  readonly overall: ProviderTally
  readonly cooling: readonly CoolingEntry[]
  readonly last5m: RateWindow
  readonly counters: SnapshotCounters
}

/** The five providers in display order. emptySnapshot needs the list even when nobody is configured. */
export const PROVIDER_ORDER: readonly ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

/** Placeholder for ProviderTally.providerId on the whole-pool aggregate; not a real provider. */
export const ALL_PROVIDERS = 'all' as ProviderId

const RATE_WINDOW_MS = 5 * 60_000
const HOUR_MS = 60 * 60_000


function windowRate(events: readonly MetricsEvent[], nowMs: number): RateWindow {
  const since = nowMs - RATE_WINDOW_MS
  let requests = 0
  let err429 = 0
  for (const event of events) {
    if (event.ts < since) continue
    requests += 1
    if (event.status === 429) err429 += 1
  }
  if (requests === 0) return { requests, err429, rate: null }
  const pct = (err429 / requests) * 100
  return {
    requests,
    err429,
    rate: { value: pct.toFixed(2), source: 'assume', ref: 'local counters, ' + String(RATE_WINDOW_MS) + 'ms window' },
  }
}

/** Available is the one status that counts: a cooling or unknown-quota account is not usable now. */
function accountIsUsable(status: AccountStatus): boolean {
  return status === 'available'
}

function tallyOf(accounts: readonly ClientAccount[]): AccountTally {
  let available = 0
  let total = 0
  for (const account of accounts) {
    total += 1
    if (account.enabled && accountIsUsable(account.status)) available += 1
  }
  return { available, total }
}

/**
 * Projects an account for the wire. The secret is not a field of Account, but the
 * record arriving here is structurally wider; listing the fields we keep means a
 * future field cannot leak by default. scrubSecrets is belt and braces.
 */
export function toClientAccount(account: Account): ClientAccount {
  const out: ClientAccount = {
    providerId: account.providerId,
    accountAlias: scrubSecrets(String(account.accountAlias)),
    keyIdMasked: scrubSecrets(String(account.keyIdMasked)),
    enabled: account.enabled === true,
    status: account.status,
    ...(account.coolUntil === undefined ? {} : { coolUntil: account.coolUntil }),
    ...(account.cooldownReason === undefined ? {} : { cooldownReason: account.cooldownReason }),
  }
  return out
}

export interface UsageInput {
  readonly usage?: UsageResult | null
}

/**
 * Per-provider card data for docs/05 section 3.2. Absent usage stays absent: the caller
 * checks `usageAvailable` and renders "no endpoint" rather than a zero.
 */
export function providerSnapshotOf(
  providerId: ProviderId,
  accounts: readonly ClientAccount[],
  events: readonly MetricsEvent[],
  nowMs: number,
  usage?: UsageResult | null,
): ProviderSnapshot {
  const mine = accounts.filter((account) => account.providerId === providerId)
  const hourFloor = nowMs - HOUR_MS
  const byKind: Partial<Record<RateKind, number>> = {}
  let err429LastHour = 0
  for (const event of events) {
    if (event.providerId !== providerId) continue
    if (event.status !== 429) continue
    if (event.ts < hourFloor) continue
    err429LastHour += 1
    if (event.rateKind !== undefined) {
      byKind[event.rateKind] = (byKind[event.rateKind] ?? 0) + 1
    }
  }
  const usageAvailable = usage !== null && usage !== undefined && usage.available === true
  return {
    providerId,
    tally: tallyOf(mine),
    ...(usage?.rpmLimit === undefined ? {} : { rpmLimit: usage.rpmLimit }),
    ...(usage?.dailyUsedPts === undefined ? {} : { dailyUsedPts: usage.dailyUsedPts }),
    ...(usage?.dailyLimitPts === undefined ? {} : { dailyLimitPts: usage.dailyLimitPts }),
    ...(usage?.dailyResetAt === undefined ? {} : { dailyResetAt: usage.dailyResetAt }),
    ...(usage?.fetchedAt === undefined ? {} : { usageFetchedAt: usage.fetchedAt }),
    usageAvailable,
    ...(usageAvailable ? { usageSource: 'api' as const } : {}),
    ...(usage?.reason === undefined ? {} : { usageUnavailableReason: usage.reason }),
    err429LastHour,
    err429ByKind: byKind,
  }
}

export interface SnapshotInput {
  readonly accounts: readonly Account[]
  readonly events: readonly MetricsEvent[]
  readonly nowMs: number
  readonly activeSessions: number
  readonly queued: number
  /** Usage per provider, keyed by provider id. Absent for providers with no endpoint. */
  readonly usage?: Readonly<Partial<Record<ProviderId, UsageResult | null>>>
}

/**
 * Builds the whole payload. The event list is passed through only as aggregates --
 * requests, 429s marked by rate kind, and the cooling accounts -- so raw requests do not
 * travel to the client just to be counted there. That is what keeps D-02 honest on the
 * wire and not merely on disk.
 */
export function buildSnapshot(input: SnapshotInput, providers: readonly ProviderId[]): Snapshot {
  const accounts = input.accounts.map(toClientAccount)
  const cooling: CoolingEntry[] = []
  for (const account of accounts) {
    if (account.coolUntil === undefined || account.coolUntil <= input.nowMs) continue
    cooling.push({
      providerId: account.providerId,
      accountAlias: account.accountAlias,
      rateKind: account.cooldownReason ?? 'rate_opaque',
      untilMs: account.coolUntil,
    })
  }
  cooling.sort((a, b) => a.untilMs - b.untilMs)

  const perProvider = providers.map((providerId) =>
    providerSnapshotOf(providerId, accounts, input.events, input.nowMs, input.usage?.[providerId]),
  )
  const overallTally: AccountTally = tallyOf(accounts)
  const overall: ProviderTally = { ...overallTally, providerId: ALL_PROVIDERS, configured: accounts.length > 0 }
  return {
    generatedAtMs: input.nowMs,
    accounts,
    providers: perProvider,
    overall,
    cooling,
    last5m: windowRate(input.events, input.nowMs),
    counters: { activeSessions: input.activeSessions, queued: input.queued },
  }
}

/**
 * An empty pool: no accounts, no events, no usage.
 *
 * This is the snapshot an install has before the host has said anything -- the browser half
 * may mount before the wire is attached, or the host may be shut down. It is deliberately
 * built through the same code path as a live pool so it cannot drift into "0 available" or
 * "null total" by accident; every provider comes back configured:false.
 */
export function emptySnapshot(): Snapshot {
  return buildSnapshot({ accounts: [], events: [], nowMs: 0, activeSessions: 0, queued: 0 }, PROVIDER_ORDER)
}

/** JSON form handed to the client plugin. Same bytes, one place to call scrubSecrets. */
export function serializeSnapshot(snapshot: Snapshot): string {
  return scrubSecrets(JSON.stringify(snapshot))
}

/** Types the untrusted client-facing shape back into Sourced<number>, refusing the rest. */
export function sourcedNumberFromWire(value: unknown): Sourced<number> | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record['value'] !== 'number' || !Number.isFinite(record['value'])) return null
  if (typeof record['source'] !== 'string') return null
  return record as unknown as Sourced<number>
}
