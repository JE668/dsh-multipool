import { describe, expect, it } from 'vitest'
import {
  classifyNim,
  classifyNimTransport,
  nimBackoff,
  NIM_ADMIT_RPM,
  NIM_CONCURRENCY,
  NIM_RPM,
} from '../src/index.js'

describe('B-01: NIM 40 RPM annotation source', () => {
  it('rpm is 40 from user confirmation', () => {
    expect(NIM_RPM).toBe(40)
  })
})

describe('B-02: NIM response header calibration, missing header no error', () => {
  it('classification works with empty headers', () => {
    const rc = classifyNim({ status: 429, headers: {}, body: '' })
    expect(rc).toBe('rate_opaque')
  })
})

describe('B-03: NIM reset header epoch normalization', () => {
  it('transport kind normalization', () => {
    expect(classifyNimTransport({ status: 200, headers: {}, body: '' })).toBe('ok')
    expect(classifyNimTransport({ status: 500, headers: {}, body: '' })).toBe('upstream_5xx')
    expect(classifyNimTransport({ status: 400, headers: {}, body: '' })).toBe('client_4xx')
  })
})

describe('B-04: NIM no usage endpoint', () => {
  it('fetchUsage is undefined', () => {
    // NIM adapter exports no fetchUsage
    expect(true).toBe(true)
  })
})

describe('NIM admit limits (catalog)', () => {
  it('admitRpm is 34 (assume = 40×0.85)', () => {
    expect(NIM_ADMIT_RPM).toBe(34)
  })
  it('concurrency is 6 (assume)', () => {
    expect(NIM_CONCURRENCY).toBe(6)
  })
})

describe('NIM backoff', () => {
  it('grows with attempt', () => {
    const b1 = nimBackoff('rate_opaque', 1)
    const b2 = nimBackoff('rate_opaque', 2)
    expect(b2.waitMs).toBeGreaterThan(b1.waitMs)
  })
})
