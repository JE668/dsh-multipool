/**
 * The dashboard's minute buckets (docs/06 T-3-b, fixture U-08).
 *
 * Pure functions over the same events metrics.ts keeps: this module decides how a window of
 * finished requests is folded into a line, and nothing else. It does not hold time, it does not
 * hold events, and it never asks the upstream -- a caller hands it what the store already has and
 * the moment it is drawing for.
 *
 * The one rule that shapes all of it is U-08: a minute with no requests is not a minute with zero
 * requests. Zero is a reading ("we sent nothing"), absence is not a reading ("nobody was watching
 * yet"), and a chart that draws the second as the first puts a floor under the traffic that the
 * plugin never measured. So an empty minute is a hole in the series, and `rate` is null there
 * rather than "0.00".
 */

import type { MetricsEvent, ProviderId, RateKind } from './contract.js'

/** One minute, one point. `requests` may be zero; zero is a count, and a count is a reading. */
export interface TrendPoint {
  /** Epoch ms of the minute's start (already floored), so points sort and align without a clock. */
  readonly atMs: number
  readonly requests: number
  /** Requests that came back 429 in this minute. A subset of `requests`, never more than it. */
  readonly err429: number
  /**
   * 429s as a percentage of the minute's requests, or null when the minute had none.
   *
   * Null rather than "0.00" for the same reason line three prints an em dash: a minute with no
   * traffic cannot tell you the traffic was healthy. The value is a string because it is a number
   * shown to a person, and `source` rides along so the panel can label it as counters, not the
   * upstream's own figure (docs/05 section 3.2).
   */
  readonly rate: { readonly value: string; readonly source: string; readonly ref: string } | null
  /** 429s by the class the proxy recorded, so a rate window spike can be read without guessing. */
  readonly err429ByKind: Readonly<Partial<Record<RateKind, number>>>
}

export const MINUTE_MS = 60_000

/** The ref that rides on every rate this module computes: it is arithmetic over our own rows. */
export const COUNTERS_REF = 'local counters, 60000ms buckets'

function floorMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/**
 * Fold events into the minutes that end at `nowMs`, oldest first.
 *
 * `minutes` is how many to return, counting the minute `nowMs` falls in as the last one. Points for
 * minutes the store has no events in are returned with `requests: 0` and `rate: null` -- present, so
 * a caller can index them by time, and empty, so a painter cannot read them as measured calm. A
 * caller that wants the line broken at those minutes can break on `rate === null` without this
 * module having to know how the line is drawn.
 *
 * Events outside the window are ignored rather than clamped into the first bucket: a request from
 * yesterday is not a request made in this hour, and counting it here would make the first point
 * taller than its minute.
 */
export function trendOf(
  events: readonly MetricsEvent[],
  nowMs: number,
  minutes: number,
  providerId?: ProviderId,
): readonly TrendPoint[] {
  if (!Number.isInteger(minutes) || minutes < 1) return []
  const lastStart = floorMinute(nowMs)
  const firstStart = lastStart - (minutes - 1) * MINUTE_MS

  const requests = new Array<number>(minutes).fill(0)
  const errs = new Array<number>(minutes).fill(0)
  const byKind: Array<Partial<Record<RateKind, number>>> = []
  for (let i = 0; i < minutes; i += 1) byKind.push({})

  for (const event of events) {
    if (providerId !== undefined && event.providerId !== providerId) continue
    if (event.ts < firstStart || event.ts >= lastStart + MINUTE_MS) continue
    const at = Math.floor((event.ts - firstStart) / MINUTE_MS)
    requests[at] = (requests[at] ?? 0) + 1
    if (event.status === 429) {
      errs[at] = (errs[at] ?? 0) + 1
      if (event.rateKind !== undefined) {
        const bucket = byKind[at]
        if (bucket !== undefined) bucket[event.rateKind] = (bucket[event.rateKind] ?? 0) + 1
      }
    }
  }

  const points: TrendPoint[] = []
  for (let i = 0; i < minutes; i += 1) {
    const count = requests[i] ?? 0
    const errs429 = errs[i] ?? 0
    points.push({
      atMs: firstStart + i * MINUTE_MS,
      requests: count,
      err429: errs429,
      rate:
        count === 0
          ? null
          : {
              value: ((errs429 / count) * 100).toFixed(2),
              source: 'assume',
              ref: COUNTERS_REF,
            },
      err429ByKind: byKind[i] ?? {},
    })
  }
  return points
}
