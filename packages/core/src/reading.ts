/**
 * What a dashboard read hands back (docs/06 T-3-b, fixtures U-07 and U-08).
 *
 * The two halves of a dashboard are two different questions about the same records, and they age
 * differently: the curve is a minute-by-minute fold of finished requests, the table is the last
 * few of those requests one at a time. The page needs both on one tick, so the endpoint answers
 * one payload -- and this type exists to say out loud that the second half can be shorter than the
 * first without anything being wrong.
 */

import type { DetailRow } from './amd-table.js'
import type { TrendPoint } from './amd-trend.js'
import type { MinuteConcurrency, MinuteHeat } from './amd-concurrency.js'

/** How many minutes the curve covers: an hour, the finest window the counters can honestly fill. */
export const READING_MINUTES = 60

/** How many rows the table shows. A screenful and a half, so the table has something to scroll. */
export const READING_ROWS = 40

export interface DashboardReading {
  /**
   * The curve, oldest minute first.
   *
   * Points with no traffic are present with requests: 0 and rate: null rather than dropped: the
   * page can then see the shape of the hour (a gap at minute 12 is a different fact from a quiet
   * hour), and has to decide for itself whether to draw a line through a hole. Dropping them would
   * move every point one step left and silently re-date the traffic.
   */
  readonly trend: readonly TrendPoint[]
  /**
   * The table, newest first, capped at READING_ROWS.
   *
   * Shorter than the curve is normal: the table only holds rows since this process started, not
   * for the whole hour. A page must not read "40 points and 3 rows" as a broken measurement.
   */
  readonly rows: readonly DetailRow[]
  /**
   * Per-minute worst concurrency seen at send time, oldest minute first.
   * null where that minute recorded nothing.
   */
  readonly concurrency: readonly MinuteConcurrency[]
  /**
   * Per-minute queue-wait heat, oldest minute first, logarithmic buckets.
   */
  readonly heat: readonly MinuteHeat[]
}
