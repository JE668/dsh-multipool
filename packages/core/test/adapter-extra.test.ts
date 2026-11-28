import { describe, expect, it } from 'vitest'
import {
  AGNES_ADMIT_RPM,
  AGNES_CONCURRENCY,
  AGNES_CREDITS_PER_USD,
  AGNES_RPM,
  classifyAgnes,
  classifyAgnesTransport,
  agnesBackoff,
  agnesEmptyCatalog,
  agnesReadHeaders,
  NIM_ADMIT_RPM,
  NIM_CONCURRENCY,
  NIM_RPM,
  classifyNim,
  classifyNimTransport,
  nimBackoff,
  nimEmptyCatalog,
  nimReadHeaders,
} from '../src/index.js'

describe('NIM adapter coverage', () => {
  it('export constants', () => {
    expect(NIM_RPM).toBe(40)
    expect(NIM_CONCURRENCY).toBe(6)
    expect(NIM_ADMIT_RPM).toBe(34)
  })

  it('classifyNim: 400 with model message → model_missing', () => {
    expect(
      classifyNim({ status: 400, headers: {}, body: '{"error":{"message":"model not found"}}' }),
    ).toBe('model_missing')
  })

  it('classifyNim: 400 without model message → null', () => {
    expect(classifyNim({ status: 400, headers: {}, body: '{"error":{"message":"bad request"}}' })).toBeNull()
  })

  it('classifyNim: 200 → null', () => {
    expect(classifyNim({ status: 200, headers: {}, body: '' })).toBeNull()
  })

  it('classifyNimTransport: 429 → unknown', () => {
    expect(classifyNimTransport({ status: 429, headers: {}, body: '' })).toBe('unknown')
  })

  it('nimBackoff: various rate classes and attempts', () => {
    const b1 = nimBackoff('auth', 1)
    expect(b1.waitMs).toBe(1_000)
    const b2 = nimBackoff('rate_opaque', 20)
    expect(b2.waitMs).toBeLessThanOrEqual(60_000)
  })

  it('nimReadHeaders returns null', () => {
    expect(nimReadHeaders({ status: 200, headers: {}, body: '' })).toBeNull()
  })

  it('nimEmptyCatalog returns ok=true with empty models', () => {
    const cat = nimEmptyCatalog()
    expect(cat.ok).toBe(true)
    expect(cat.models).toEqual([])
    expect(typeof cat.fetchedAt).toBe('string')
  })
})

describe('Agnes adapter coverage', () => {
  it('export constants', () => {
    expect(AGNES_RPM).toBe(20)
    expect(AGNES_ADMIT_RPM).toBe(17)
    expect(AGNES_CONCURRENCY).toBe(8)
    expect(AGNES_CREDITS_PER_USD).toBe(6600)
  })

  it('classifyAgnes: 402 → plan_credit', () => {
    expect(classifyAgnes({ status: 402, headers: {}, body: '' })).toBe('plan_credit')
  })

  it('classifyAgnes: 400 with model message → model_missing', () => {
    expect(
      classifyAgnes({ status: 400, headers: {}, body: '{"error":{"message":"model not supported"}}' }),
    ).toBe('model_missing')
  })

  it('classifyAgnes: 200 → null', () => {
    expect(classifyAgnes({ status: 200, headers: {}, body: '' })).toBeNull()
  })

  it('classifyAgnesTransport: 429 → unknown', () => {
    expect(classifyAgnesTransport({ status: 429, headers: {}, body: '' })).toBe('unknown')
  })

  it('agnesBackoff: grows with attempt, capped', () => {
    const b1 = agnesBackoff('plan_credit', 1)
    expect(b1.waitMs).toBe(2_000)
    const b2 = agnesBackoff('plan_credit', 20)
    expect(b2.waitMs).toBeLessThanOrEqual(60_000)
  })

  it('agnesReadHeaders returns null', () => {
    expect(agnesReadHeaders({ status: 200, headers: {}, body: '' })).toBeNull()
  })

  it('agnesEmptyCatalog returns ok=true with empty models', () => {
    const cat = agnesEmptyCatalog()
    expect(cat.ok).toBe(true)
    expect(cat.models).toEqual([])
    expect(typeof cat.fetchedAt).toBe('string')
  })
})
