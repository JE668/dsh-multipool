/**
 * One hour of minutes as an SVG line, and the rows behind it (docs/06 T-3-b).
 *
 * Hand-drawn rather than pulled from a charting library: DSH's desktop renderer ships no echarts (or
 * any other), the profile's @deepseek-ai directory is empty, and a dashboard that is blank on an
 * install which merely lacks a dependency is worse than a dashboard with plainer lines. What is
 * needed is a viewBox, a polyline and axis text, all of which are SVG 1.1.
 *
 * The one rule this file refuses to break is the hole. A minute with no requests draws no point and
 * no segment: `trendOf()` already leaves `rate` null there, so the line is emitted per unbroken run
 * of minutes that actually happened. A painter that called `.toFixed()` on every bucket and drew
 * through the nulls would put a calm flat line over an hour nobody measured -- the exact claim
 * docs/07 U-08 exists to prevent -- and would look more convincing than no chart at all.
 */

import type { TrendPoint } from './amd-trend.js'

/** Plot box in viewBox units. The numbers are units, not pixels: CSS scales the whole figure. */
export const PLOT_WIDTH = 320
export const PLOT_HEIGHT = 96
const PAD_X = 6
const PAD_Y = 12

/** Runs of minutes with a rate, in the oldest-first order trendOf() returns. */
interface Run {
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

function runsOf(trend: readonly TrendPoint[]): readonly Run[] {
  const runs: Run[] = []
  let current: { x: number; y: number }[] = []
  const span = Math.max(1, trend.length - 1)
  const plotWidth = PLOT_WIDTH - PAD_X * 2
  const plotHeight = PLOT_HEIGHT - PAD_Y * 2

  for (let index = 0; index < trend.length; index += 1) {
    const point = trend[index]
    const rate = point === undefined ? null : point.rate
    if (rate === null || rate === undefined) {
      // A minute with no traffic is a hole, not a zero. Closing the run here is the whole point.
      if (current.length > 0) runs.push({ points: current })
      current = []
      continue
    }
    const share = Number(rate.value)
    const x = PAD_X + (index / span) * plotWidth
    // Rate is a percentage from 0 to 100; the y axis is inverted because SVG's grows downward.
    const safe = Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 0
    const y = PAD_Y + (1 - safe / 100) * plotHeight
    current.push({ x, y })
  }
  if (current.length > 0) runs.push({ points: current })
  return runs
}

/**
 * One number, one decimal.
 *
 * The coordinates are geometry, not measurements: a hundredth of a viewBox unit is a thousandth of a
 * pixel, and printing the float's residue ("55.199999999999996") puts the arithmetic in the markup
 * where nobody can read it and every snapshot has to be rewritten when the order of operations
 * changes. Rounding here does not touch a rate -- the rate was rounded when the buckets were folded.
 */
function units(value: number): string {
  return value.toFixed(1)
}

function polylineOf(run: Run): string {
  return run.points.map(point => units(point.x) + ',' + units(point.y)).join(' ')
}

export interface TrendFigure {
  readonly width: number
  readonly height: number
  /** Each entry is one unbroken stretch of minutes that had traffic; a gap between entries is a hole. */
  readonly lines: readonly string[]
  /** The minute labels worth printing, as [x, text] pairs. Sparse on purpose. */
  readonly axis: readonly { readonly x: number; readonly label: string }[]
}

/**
 * The figure's parts, without a React in sight.
 *
 * Kept as data so the test can assert the shape the drawer depends on -- how many runs, where they
 * break, what the axis says -- instead of poking at JSX. A drawing bug and a data bug look the same
 * in a snapshot but not in these numbers.
 */
export function trendFigureOf(trend: readonly TrendPoint[], hourLabel: (atMs: number) => string): TrendFigure {
  const runs = runsOf(trend)
  const first = trend[0]
  const last = trend[trend.length - 1]
  const axis: { readonly x: number; readonly label: string }[] = []
  if (first !== undefined && last !== undefined) {
    const span = Math.max(1, trend.length - 1)
    const plotWidth = PLOT_WIDTH - PAD_X * 2
    const step = Math.max(1, Math.floor(span / 4))
    for (let index = 0; index < trend.length; index += step) {
      const point = trend[index]
      if (point === undefined) continue
      axis.push({ x: PAD_X + (index / span) * plotWidth, label: hourLabel(point.atMs) })
    }
    axis.push({ x: PAD_X + plotWidth, label: hourLabel(last.atMs) })
  }
  return { width: PLOT_WIDTH, height: PLOT_HEIGHT, lines: runs.map(polylineOf), axis }
}

/**
 * Why the curve is not drawn on a fresh install, said on the page instead of as an empty box.
 *
 * Three absences look identical in an SVG -- no host answering, a host that has recorded nothing
 * yet, and an hour in which the pool really was idle -- and two of them are not the same claim. The
 * figure stays blank for all three; this sentence is what keeps the blank from speaking for them.
 */
export function trendNoteOf(answered: boolean, measured: number): string {
  if (!answered) return 'trend: no host answered'
  if (measured === 0) return 'trend: nothing recorded yet'
  return 'trend: ' + String(measured) + ' of the last hour had traffic'
}
