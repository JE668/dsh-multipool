import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import type { MetricsEvent } from '../src/contract.js'
import { RETENTION_MS, createMetricsStore, shanghaiDayKey } from '../src/metrics.js'

const DAY_MS = 24 * 60 * 60 * 1_000
/** Shanghai midnight of 2026-11-01. */
const DAY_ONE = Date.UTC(2026, 10, 1, 0, 0, 0) - 8 * 60 * 60 * 1_000

function eventAt(day: number, slot: number): MetricsEvent {
  return {
    ts: DAY_ONE + day * DAY_MS + slot * 60_000,
    providerId: 'amd',
    accountAlias: 'acct-a',
    keyIdMasked: 'rc-SECRET-a',
    modelId: 'DeepSeek-V4-Flash',
    requestId: `req-${day}-${slot}`,
    status: 200,
    latencyMs: 120,
    attempt: 1,
    concurrencyAtSend: 1,
  }
}

describe('D-01 thirty days of events, thirty-one days of rollups', () => {
  it('clears the day that fell out of the window and keeps the other thirty', () => {
    const clock = createFakeClock({ now: DAY_ONE })
    const store = createMetricsStore(clock)

    // Days 1..31, ten events each. Day 0 lands outside the window. 
    for (let day = 1; day <= 31; day += 1) {
      for (let slot = 0; slot < 10; slot += 1) store.append(eventAt(day, slot))
    }

    const nowMs = DAY_ONE + 32 * DAY_MS
    store.prune(nowMs)

    const days = [...new Set(store.events().map(event => shanghaiDayKey(event.ts)))].sort()
    const expected = Array.from({ length: 30 }, (_, index) => shanghaiDayKey(DAY_ONE + (index + 2) * DAY_MS)).sort()
    expect(days).toEqual(expected)
    expect(store.events().length).toBe(300)

    const rollups = store.rollups()
    expect(rollups.every(rollup => rollup.requests === 10)).toBe(true)
    expect(RETENTION_MS).toBe(DAY_MS * 30)
  })
})

describe('D-02 stored events carry counters, never content', () => {
  it('serialises no messages, no prompt text and no Authorization value', () => {
    const clock = createFakeClock({ now: 0 })
    const store = createMetricsStore(clock)
    store.append({
      ts: DAY_ONE,
      providerId: 'amd',
      accountAlias: 'acct-a',
      keyIdMasked: 'rc-SECRET',
      modelId: 'DeepSeek-V4-Flash',
      requestId: 'req-1',
      status: 200,
      latencyMs: 120,
      attempt: 1,
      promptTokens: 10,
      completionTokens: 5,
      concurrencyAtSend: 1,
    })

    const serialised = JSON.stringify(store.events())
    // D-02: no message bodies, no credential in any casing accepted by the wire.
    // promptTokens is a counter and stays; a prompt itself would not.
    expect(serialised).not.toContain('messages')
    expect(serialised).not.toMatch(/"prompt":/)
    expect(serialised).not.toMatch(/authorization/i)
    expect(serialised).toContain('rc-SECRET')
  })
})
