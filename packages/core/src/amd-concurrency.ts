/**
 * Per-minute folds of the events store that the dashboard draws but does not use for admission:
 * concurrency seen at send time, and queue-wait heat (docs/05 section 3.2).
 *
 * Like amd-trend.ts: a minute with no requests keeps its point, its value is null rather than 0,
 * and nothing here is invented.
 */

import { MINUTE_MS } from './amd-trend.js'
import type { MetricsEvent } from './contract.js'

function floorMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/** The worst concurrency the host saw land in one drawn minute. */
export interface MinuteConcurrency {
  readonly atMs: number
  /** null when that minute had no recorded request carrying a concurrency figure. */
  readonly maxConcurrency: number | null
}

/** Queue-wait heat buckets, in milliseconds (docs/05 section 3.2, logarithmic). */
export interface QueueHeatBucket {
  '0-1s': number
  '1-5s': number
  '5-30s': number
  '30s+': number
}

export interface MinuteHeat {
  readonly atMs: number
  readonly buckets: QueueHeatBucket
}

function emptyBuckets(): QueueHeatBucket {
  return { '0-1s': 0, '1-5s': 0, '5-30s': 0, '30s+': 0 }
}

function bucketOf(queueWaitMs: number | undefined): keyof QueueHeatBucket | null {
  if (queueWaitMs === undefined || queueWaitMs === null || !isFinite(queueWaitMs) || queueWaitMs < 0) return null
  if (queueWaitMs <= 1_000) return '0-1s'
  if (queueWaitMs <= 5_000) return '1-5s'
  if (queueWaitMs <= 30_000) return '5-30s'
  return '30s+'
}

export function concurrencyOf(
  events: readonly MetricsEvent[],
  nowMs: number,
  minutes: number,
): readonly MinuteConcurrency[] {
  if (!Number.isInteger(minutes) || minutes < 1) return []
  const lastStart = floorMinute(nowMs)
  const firstStart = lastStart - (minutes - 1) * MINUTE_MS
  const max: number[] = new Array(minutes).fill(0)
  const seen: boolean[] = new Array(minutes).fill(false)
  for (const event of events) {
    if (event.ts < firstStart || event.ts >= lastStart + MINUTE_MS) continue
    const at = Math.floor((event.ts - firstStart) / MINUTE_MS)
    const c = event.concurrencyAtSend
    if (typeof c === 'number' && isFinite(c) && c >= 0) {
      seen[at] = true
      const previous = max[at] ?? 0
      if (c > previous) max[at] = c
    }
  }
  const out: MinuteConcurrency[] = []
  for (let at = 0; at < minutes; at += 1) {
    out.push({ atMs: firstStart + at * MINUTE_MS, maxConcurrency: seen[at] ? max[at] ?? null : null })
  }
  return out
}

export function heatOf(
  events: readonly MetricsEvent[],
  nowMs: number,
  minutes: number,
): readonly MinuteHeat[] {
  if (!Number.isInteger(minutes) || minutes < 1) return []
  const lastStart = floorMinute(nowMs)
  const firstStart = lastStart - (minutes - 1) * MINUTE_MS
  const buckets: QueueHeatBucket[] = new Array(minutes).fill(null).map(() => emptyBuckets())
  const seen: boolean[] = new Array(minutes).fill(false)
  for (const event of events) {
    if (event.ts < firstStart || event.ts >= lastStart + MINUTE_MS) continue
    const at = Math.floor((event.ts - firstStart) / MINUTE_MS)
    const b = bucketOf(event.queueWaitMs)
    if (b !== null) {
      seen[at] = true
      buckets[at]![b] += 1
    }
  }
  const out: MinuteHeat[] = []
  for (let at = 0; at < minutes; at += 1) {
    out.push({ atMs: firstStart + at * MINUTE_MS, buckets: buckets[at] ?? emptyBuckets() })
  }
  return out
}
