import { describe, expect, it } from 'vitest'

import { concurrencyOf, heatOf } from '../src/amd-concurrency.js'
import type { MetricsEvent } from '../src/contract.js'

const NOW = 1_700_000_000_000

function mkEvent(
  ts: number,
  over: Partial<Pick<MetricsEvent, 'concurrencyAtSend' | 'queueWaitMs'>> = {},
): MetricsEvent {
  return {
    providerId: 'amd',
    accountAlias: 'AMD-A',
    keyIdMasked: 'rc-...1a2b',
    modelId: 'gemini-4-hydrogen',
    requestId: 'req-1',
    status: 200,
    latencyMs: 100,
    attempt: 1,
    ts,
    ...over,
  }
}

describe('concurrencyOf', () => {
  it('returns [] for minutes < 1', () => {
    expect(concurrencyOf([], NOW, 0)).toEqual([])
    expect(concurrencyOf([], NOW, -3)).toEqual([])
  })

  it('returns one point per minute, null for empty minutes', () => {
    const points = concurrencyOf([], NOW, 3)
    expect(points.length).toBe(3)
    expect(points.every((p) => p.maxConcurrency === null)).toBe(true)
    const base = Math.floor(NOW / 60_000) * 60_000
    expect(points[0]!.atMs).toBe(base - 120_000)
    expect(points[2]!.atMs).toBe(base)
  })

  it('records max concurrency per minute', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const points = concurrencyOf(
      [
        mkEvent(base + 1000, { concurrencyAtSend: 2 }),
        mkEvent(base + 2000, { concurrencyAtSend: 5 }),
        mkEvent(base + 3000, { concurrencyAtSend: 3 }),
      ],
      NOW,
      1,
    )
    expect(points.length).toBe(1)
    expect(points[0]!.maxConcurrency).toBe(5)
  })

  it('null concurrency does not mark minute as seen', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const points = concurrencyOf([mkEvent(base + 1000, { concurrencyAtSend: null })], NOW, 1)
    expect(points[0]!.maxConcurrency).toBe(null)
  })

  it('window is [firstStart, lastStart + MINUTE_MS)', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const before = concurrencyOf([mkEvent(base - 1, { concurrencyAtSend: 9 })], NOW, 1)
    expect(before[0]!.maxConcurrency).toBe(null)
    const inside = concurrencyOf([mkEvent(base, { concurrencyAtSend: 9 })], NOW, 1)
    expect(inside[0]!.maxConcurrency).toBe(9)
  })
})

describe('heatOf', () => {
  it('returns [] for minutes < 1', () => {
    expect(heatOf([], NOW, 0)).toEqual([])
  })

  it('returns one bucket per minute, all zeros for empty minutes', () => {
    const points = heatOf([], NOW, 3)
    expect(points.length).toBe(3)
    expect(
      points.every(
        (p) => p.buckets['0-1s'] === 0 && p.buckets['30s+'] === 0,
      ),
    ).toBe(true)
  })

  it('counts queue wait into correct bucket', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const points = heatOf(
      [
        mkEvent(base + 1000, { queueWaitMs: 500 }),
        mkEvent(base + 2000, { queueWaitMs: 2_000 }),
        mkEvent(base + 3000, { queueWaitMs: 10_000 }),
        mkEvent(base + 4000, { queueWaitMs: 60_000 }),
      ],
      NOW,
      1,
    )
    expect(points[0]!.buckets['0-1s']).toBe(1)
    expect(points[0]!.buckets['1-5s']).toBe(1)
    expect(points[0]!.buckets['5-30s']).toBe(1)
    expect(points[0]!.buckets['30s+']).toBe(1)
  })

  it('null / undefined / negative queueWaitMs is ignored', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const points = heatOf(
      [
        mkEvent(base + 1000, { queueWaitMs: null }),
        mkEvent(base + 2000, { queueWaitMs: undefined }),
        mkEvent(base + 3000, { queueWaitMs: -1 }),
      ],
      NOW,
      1,
    )
    expect(points[0]!.buckets['0-1s']).toBe(0)
    expect(points[0]!.buckets['30s+']).toBe(0)
  })

  it('boundary: exactly 1s goes to 0-1s, exactly 5s goes to 1-5s, exactly 30s goes to 5-30s', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const points = heatOf(
      [
        mkEvent(base + 1000, { queueWaitMs: 1_000 }),
        mkEvent(base + 2000, { queueWaitMs: 5_000 }),
        mkEvent(base + 3000, { queueWaitMs: 30_000 }),
      ],
      NOW,
      1,
    )
    expect(points[0]!.buckets['0-1s']).toBe(1)
    expect(points[0]!.buckets['1-5s']).toBe(1)
    expect(points[0]!.buckets['5-30s']).toBe(1)
  })

  it('window excludes events before firstStart', () => {
    const base = Math.floor(NOW / 60_000) * 60_000
    const before = heatOf([mkEvent(base - 60_000 - 1, { queueWaitMs: 500 })], NOW, 1)
    expect(before[0]!.buckets['0-1s']).toBe(0)
  })
})
