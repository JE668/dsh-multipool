
import { describe, expect, it } from 'vitest'

import { rowsOf, sortRows, type DetailRow } from '../src/amd-table.js'
import type { MetricsEvent } from '../src/contract.js'

const NOW = Date.UTC(2026, 10, 28, 2, 30, 30)

function ev(offsetMs: number, extra: Partial<MetricsEvent> = {}): MetricsEvent {
  return {
    ts: NOW + offsetMs,
    providerId: 'amd',
    accountAlias: 'acct-a',
    keyIdMasked: 'rc-1a2b',
    modelId: 'DeepSeek-V4-Flash',
    requestId: 'req-' + String(Math.abs(offsetMs)),
    status: 200,
    latencyMs: 120,
    attempt: 1,
    concurrencyAtSend: 1,
    ...extra,
  }
}

function ids(rows: readonly DetailRow[]): readonly string[] {
  return rows.map(row => row.requestId)
}

describe('the detail table', () => {
  it('is newest first, because the question it answers is what just happened', () => {
    const rows = rowsOf([ev(-3000), ev(-1000), ev(-2000)])
    expect(ids(rows)).toEqual(['req-1000', 'req-2000', 'req-3000'])
  })

  it('caps at the limit it was given, and a zero limit is an empty table not the whole one', () => {
    const events = [ev(-1000), ev(-2000), ev(-3000)]
    expect(rowsOf(events, 2).length).toBe(2)
    expect(ids(rowsOf(events, 2))).toEqual(['req-1000', 'req-2000'])
    expect(rowsOf(events, 0).length).toBe(0)
  })

  it('leaves a missing count missing, so the page can tell it from a zero', () => {
    const row = rowsOf([ev(-1000)])[0]
    expect(row?.promptTokens).toBe(null)
    expect(row?.completionTokens).toBe(null)
    expect(row?.queueWaitMs).toBe(null)
    expect(row?.latencyMs).toBe(120)
    expect(row?.attempt).toBe(1)
  })

  it('keeps a counted zero as a zero', () => {
    const rows = rowsOf([ev(-1000, { promptTokens: 0, completionTokens: 0, queueWaitMs: 0 })])
    expect(rows[0]?.promptTokens).toBe(0)
    expect(rows[0]?.completionTokens).toBe(0)
    expect(rows[0]?.queueWaitMs).toBe(0)
  })

  it('masks the key again on the way out, whatever it was handed', () => {
    const rows = rowsOf([ev(-1000, { keyIdMasked: 'rc-0123456789abcdef0123456789abcdef' })])
    const serialsed = JSON.stringify(rows)
    expect(serialsed).not.toContain('0123456789abcdef0123456789abcdef')
    expect(serialsed).toContain('rc-')
  })

  it('sorting a column by a null key cannot be done: nulls go to the end either way', () => {
    const rows = rowsOf([
      ev(-1000, { promptTokens: 30 }),
      ev(-2000, { promptTokens: 10 }),
      ev(-3000),
      ev(-4000, { promptTokens: 20 }),
    ])
    expect(ids(sortRows(rows, 'promptTokens', false))).toEqual(['req-2000', 'req-4000', 'req-1000', 'req-3000'])
    expect(ids(sortRows(rows, 'promptTokens', true))).toEqual(['req-1000', 'req-4000', 'req-2000', 'req-3000'])
  })

  it('does not mutate the rows it was given', () => {
    const rows = rowsOf([ev(-1000, { promptTokens: 30 }), ev(-2000, { promptTokens: 10 })])
    const before = ids(rows)
    sortRows(rows, 'promptTokens', false)
    expect(ids(rows)).toEqual(before)
  })
})
