import { describe, expect, it } from 'vitest'

import { MINUTE_MS, type TrendPoint } from '../src/amd-trend.js'
import { PLOT_HEIGHT, PLOT_WIDTH, trendFigureOf, trendNoteOf } from '../src/dashboard.js'

const NOW = Date.UTC(2026, 10, 28, 2, 30, 30)

function point(minute: number, value: string | null): TrendPoint {
  return {
    atMs: NOW + minute * MINUTE_MS,
    requests: value === null ? 0 : 10,
    err429: value === null ? 0 : 1,
    rate: value === null ? null : { value, source: 'assume', ref: 'local counters, 60000ms buckets' },
    err429ByKind: {},
  }
}

const label = (atMs: number): string => String(Math.floor((atMs - NOW) / MINUTE_MS))

describe('the trend figure', () => {
  it('draws nothing for an hour that had no requests, rather than a flat line at zero', () => {
    const figure = trendFigureOf([point(0, null), point(1, null), point(2, null), point(3, null)], label)
    expect(figure.lines).toEqual([])
  })

  it('breaks the line at a hole instead of drawing through it', () => {
    const figure = trendFigureOf(
      [point(0, '10.00'), point(1, '20.00'), point(2, null), point(3, '30.00'), point(4, '40.00')],
      label,
    )
    expect(figure.lines.length).toBe(2)
    expect(figure.lines[0]).toBe('6.0,76.8 83.0,69.6')
    expect(figure.lines[1]).toBe('237.0,62.4 314.0,55.2')
  })

  it('puts a hundred percent at the top and zero at the bottom, not the other way', () => {
    const figure = trendFigureOf([point(0, '0.00'), point(1, '100.00')], label)
    expect(figure.lines.length).toBe(1)
    // An SVG y that grows with the rate is an SVG with the chart upside down.
    const [low, high] = (figure.lines[0] ?? '').split(' ')
    expect(Number((low ?? '').split(',')[1])).toBe(PLOT_HEIGHT - 12)
    expect(Number((high ?? '').split(',')[1])).toBe(12)
  })

  it('starts the axis at the first minute and ends it at the last', () => {
    const figure = trendFigureOf([point(0, '1.00'), point(1, '2.00'), point(2, '3.00')], label)
    expect(figure.width).toBe(PLOT_WIDTH)
    expect(figure.axis[0]).toEqual({ x: 6, label: '0' })
    expect(figure.axis[figure.axis.length - 1]).toEqual({ x: 314, label: '2' })
  })
})

describe('the note under an empty figure', () => {
  it('separates no host from a host with nothing recorded', () => {
    // Same blank box, two different facts. A page that printed one sentence for both would be
    // telling whoever reads it that the pool was quiet when in truth nobody was listening.
    expect(trendNoteOf(false, 0)).toBe('trend: no host answered')
    expect(trendNoteOf(true, 0)).toBe('trend: nothing recorded yet')
  })

  it('counts the minutes that had traffic, when there were some', () => {
    expect(trendNoteOf(true, 37)).toBe('trend: 37 of the last hour had traffic')
  })
})
