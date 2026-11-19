/**
 * Metrics storage: docs/06 T-1-h, event collection plus retention.
 *
 * A MetricsEvent carries counters and identifiers, never the text of a request --
 * no messages, no prompt, no Authorization value. D-02 asserts exactly that on the
 * serialized form, so the type here must never grow a field that could hold a body.
 *
 * Two lifetimes, per 03 section 3.4:
 *   events  -- thirty days, then gone (D-01: day 1 clears, days 2..31 survive)
 *   rollups -- one per finished day, kept forever
 *
 * ts is milliseconds since the epoch, matching what contract.ts already declares.
 */

import type { Clock } from './clock.js'
import { pointsFor, type PriceInMillion } from './pricing.js'
import type { DailyRollup, MetricsEvent, ProviderId, RateKind } from './contract.js'

/** 03 section 3.4: events live thirty days. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

/** Asia/Shanghai is UTC+8 with no daylight saving, so the offset is a constant. */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000

/** Days tick over at Shanghai midnight, the same boundary AMD bills against. */
export function shanghaiDayKey(ms: number): string {
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

export interface MetricsStore {
  /** Record one finished request. Events older than the window are dropped. */
  append(event: MetricsEvent): void
  /** Fold day-entries that have aged out, and drop their events. */
  prune(nowMs: number): void
  /** Cockpit-facing reads; both are windows, never the whole history. */
  events(): readonly MetricsEvent[]
  rollups(): readonly DailyRollup[]
}

/** A rollup starts from a finished day's events, and is then folded into the store. */
interface MutableCounters {
  requests: number
  errors: number
  err429: Record<string, number>
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
}

export function rollupOf(
  events: readonly MetricsEvent[],
  priceOf?: PriceLookup,
): Map<string, DailyRollup> {
  const byKey = new Map<string, MutableCounters>()
  for (const event of events) {
    const key = `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}`
    let rollup = byKey.get(key)
    if (rollup === undefined) {
      rollup = {
        requests: 0,
        errors: 0,
        err429: {},
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
      }
      byKey.set(key, rollup)
    }
    rollup.requests += 1
    if (event.status >= 400) rollup.errors += 1
    if (event.status === 429 && event.rateKind !== undefined) {
      rollup.err429[event.rateKind] = (rollup.err429[event.rateKind] ?? 0) + 1
    }
    rollup.promptTokens += event.promptTokens ?? 0
    rollup.completionTokens += event.completionTokens ?? 0
    rollup.reasoningTokens += event.reasoningTokens ?? 0
    rollup.cacheReadTokens += event.cacheReadTokens ?? 0
  }
  const out = new Map<string, DailyRollup>()
  for (const [key, counters] of byKey) {
    const heads = events.filter(
      (event) => `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}` === key,
    )
    const first = heads[0]
    if (first === undefined) continue
    out.set(key, {
      date: shanghaiDayKey(first.ts),
      providerId: first.providerId,
      accountAlias: first.accountAlias,
      requests: counters.requests,
      errors: counters.errors,
      err429: { ...counters.err429 },
      promptTokens: counters.promptTokens,
      completionTokens: counters.completionTokens,
      reasoningTokens: counters.reasoningTokens,
      cacheReadTokens: counters.cacheReadTokens,
      // 03 section 3.4: null unless a price source exists. Zero would read as free.
      estimatedCostPts: sumPoints(events, key, priceOf),
    })
  }
  return out
}

/** Where a pts price comes from; undefined means "no price table", not "free". */
export type PriceLookup = (modelId: string) => PriceInMillion | null

/**
 * Total pts for the events behind one rollup key, or null when the price is unknown.
 * Null propagates rather than skipping unpriced events: a partial total would look like
 * a cheaper day than it was, and a readout that under-reports a quota invites a 429.
 */
function sumPoints(
  events: readonly MetricsEvent[],
  key: string,
  priceOf: PriceLookup | undefined,
): number | null {
  if (priceOf === undefined) return null
  const owned = events.filter(
    (event) => `${shanghaiDayKey(event.ts)}|${event.providerId}|${event.accountAlias}` === key,
  )
  if (owned.length === 0) return null
  let total = 0
  for (const event of owned) {
    const price = priceOf(event.modelId)
    if (price === null) return null
    const points = pointsFor(price, {
      promptTokens: event.promptTokens ?? 0,
      completionTokens: event.completionTokens ?? 0,
      reasoningTokens: event.reasoningTokens,
      cacheReadTokens: event.cacheReadTokens,
    })
    if (points === null) return null
    const value = Number(points)
    if (!Number.isFinite(value)) return null
    total += value
  }
  return total
}

/**
 * In-memory store. Events roll off after RETENTION_MS; each day that rolls off is
 * folded into one DailyRollup per (day, provider, account) and kept for good.
 *
 * Rolling is the caller's, not a timer's: append only records, prune folds whatever has
 * aged out against the nowMs it is given. Doing it inside append would judge an event by
 * its own timestamp, so replaying thirty-one days of fixtures would fold each day the
 * instant it arrived and leave a single rollup standing.
 */
export function createMetricsStore(clock: Clock, priceOf?: PriceLookup): MetricsStore {
  let kept: MetricsEvent[] = []
  const rollups = new Map<string, DailyRollup>()

  function fold(expired: readonly MetricsEvent[]): void {
    const byKey = rollupOf(expired, priceOf)
    for (const [key, rollup] of byKey) {
      const prior = rollups.get(key)
      if (prior === undefined) {
        rollups.set(key, rollup)
        continue
      }
      const merged: Record<string, number> = { ...prior.err429 }
      for (const [kind, count] of Object.entries(rollup.err429)) {
        merged[kind] = (merged[kind] ?? 0) + count
      }
      rollups.set(key, {
        ...prior,
        requests: prior.requests + rollup.requests,
        errors: prior.errors + rollup.errors,
        err429: merged as Partial<Record<RateKind, number>>,
        promptTokens: prior.promptTokens + rollup.promptTokens,
        completionTokens: prior.completionTokens + rollup.completionTokens,
        reasoningTokens: prior.reasoningTokens + rollup.reasoningTokens,
        cacheReadTokens: prior.cacheReadTokens + rollup.cacheReadTokens,
        estimatedCostPts: sumPoints(expired, key, priceOf),
      })
    }
  }

  function prune(nowMs: number): void {
    const floor = nowMs - RETENTION_MS
    const fresh: MetricsEvent[] = []
    const expired: MetricsEvent[] = []
    for (const event of kept) {
      void clock
      ;(event.ts < floor ? expired : fresh).push(event)
    }
    if (expired.length > 0) fold(expired)
    kept = fresh
  }

  return {
    append(event: MetricsEvent): void {
      kept.push(event)
    },
    prune(nowMs: number): void {
      prune(nowMs)
    },
    events(): readonly MetricsEvent[] {
      return kept
    },
    rollups(): readonly DailyRollup[] {
      return [...rollups.values()]
    },
  }
}
