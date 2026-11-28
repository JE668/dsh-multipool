import { describe, expect, it } from 'vitest'

import { COUNTERS_REF, MINUTE_MS, trendOf, type TrendPoint } from '../src/amd-trend.js'
import type { MetricsEvent } from '../src/contract.js'

const NOW = Date.UTC(2026, 10, 28, 2, 30, 30) // 10:30:30 at +08:00, mid-minute on purpose

function bucket(points: readonly TrendPoint[], index: number): TrendPoint {
  const point = points[index]
  if (point === undefined) throw new Error('no bucket ' + String(index))
  return point
}

function at(ts: number, extra: Partial<MetricsEvent> = {}): MetricsEvent {
  return {
    ts,
    providerId: 'amd',
    accountAlias: 'acct-a',
    keyIdMasked: 'rc-SECRET',
    modelId: 'DeepSeek-V4-Flash',
    requestId: 'req-' + String(Math.abs(ts - NOW)),
    status: 200,
    latencyMs: 120,
    attempt: 1,
    concurrencyAtSend: 1,
    ...extra,
  }
}

export { NOW, bucket, at }


describe('the trend folds events into minutes', () => {
  it('keeps empty minutes as points, so a gap is still where the gap was', () => {
    const points = trendOf([], NOW, 3)
    expect(points.length).toBe(3)
    for (const point of points) {
      expect(point.requests).toBe(0)
      expect(point.err429).toBe(0)
      expect(point.rate).toBe(null)
    }
    expect(bucket(points, 0).atMs).toBe(Math.floor(NOW / MINUTE_MS) * MINUTE_MS - 2 * MINUTE_MS)
  })

  it('ends on the minute the caller is drawing for, floored', () => {
    const points = trendOf([], NOW, 1)
    expect(bucket(points, 0).atMs).toBe(Math.floor(NOW / MINUTE_MS) * MINUTE_MS)
  })

  it('puts an event in the minute that contains it, not in the one before or after', () => {
    const edge = Math.floor(NOW / MINUTE_MS) * MINUTE_MS + MINUTE_MS
    // Window starts at edge - 2 minutes: [edge - 2m, edge - 1m, edge). The event at edge is the
    // first millisecond of a minute that is NOT in the window, so it must not appear anywhere.
    const onEdge = trendOf([at(edge)], NOW, 3)
    const justUnder = trendOf([at(edge - 1)], NOW, 3)
    expect(bucket(onEdge, 0).requests).toBe(0)
    expect(bucket(onEdge, 1).requests).toBe(0)
    expect(bucket(onEdge, 2).requests).toBe(0)
    expect(bucket(justUnder, 0).requests).toBe(0)
    expect(bucket(justUnder, 1).requests).toBe(0)
    expect(bucket(justUnder, 2).requests).toBe(1)
  })

  it('ignores events before the window instead of piling them into the first bucket', () => {
    const points = trendOf([at(NOW - 500 * MINUTE_MS)], NOW, 2)
    expect(bucket(points, 0).requests).toBe(0)
    expect(bucket(points, 1).requests).toBe(0)
  })

  it('counts 429s against the minute they arrived in, and says the rate is counters', () => {
    const points = trendOf(
      [at(NOW - 1000), at(NOW - 2000, { status: 429, rateKind: 'rpm_key' }), at(NOW - 3000, { status: 429, rateKind: 'rpm_key' })],
      NOW,
      1,
    )
    const minute = bucket(points, 0)
    expect(minute.requests).toBe(3)
    expect(minute.err429).toBe(2)
    expect(minute.err429ByKind).toEqual({ rpm_key: 2 })
    expect(minute.rate?.value).toBe('66.67')
    expect(minute.rate?.source).toBe('assume')
    expect(minute.rate?.ref).toBe(COUNTERS_REF)
  })

  it('leaves a minute with no traffic without a rate, rather than calling it zero', () => {
    const points = trendOf([at(NOW - 2 * MINUTE_MS)], NOW, 1)
    const minute = bucket(points, 0)
    expect(minute.requests).toBe(0)
    expect(minute.rate).toBe(null)
  })

  it('narrows to one provider when asked, because a mixed line answers no question', () => {
    const points = trendOf([at(NOW - 1000), at(NOW - 1500, { providerId: 'nim' as MetricsEvent['providerId'] })], NOW, 1, 'amd')
    expect(bucket(points, 0).requests).toBe(1)
  })
})
