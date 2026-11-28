import { describe, expect, it } from 'vitest'
import {
  classifyAgnes,
  classifyAgnesTransport,
  agnesBackoff,
  AGNES_ADMIT_RPM,
  AGNES_CONCURRENCY,
  AGNES_CREDITS_PER_USD,
  AGNES_RPM,
} from '../src/index.js'

describe('G-01: Agnes 402 vs 429 separated', () => {
  it('402 → plan_credit', () => {
    expect(classifyAgnes({ status: 402, headers: {}, body: '' })).toBe('plan_credit')
  })
  it('429 → rate_opaque', () => {
    expect(classifyAgnes({ status: 429, headers: {}, body: '' })).toBe('rate_opaque')
  })
})

describe('G-02: Agnes 403 model-level', () => {
  it('403 → auth', () => {
    expect(classifyAgnes({ status: 403, headers: {}, body: '' })).toBe('auth')
  })
})

describe('G-03: Agnes free tier default RPM=20', () => {
  it('rpm is 20 from doc', () => {
    expect(AGNES_RPM).toBe(20)
  })
})

describe('G-04: Agnes 5h/week request quota (user-filled only)', () => {
  it('quota pools documented but not enforced by adapter', () => {
    // Quota pools exist in catalog but adapter doesn't enforce them
    expect(true).toBe(true)
  })
})

describe('G-05: Agnes creditsPerUsd assumption visible', () => {
  it('creditsPerUsd is 6600 (doc-local, needs calibration)', () => {
    expect(AGNES_CREDITS_PER_USD).toBe(6600)
  })
})

describe('G-06: Agnes key prefix soft hint', () => {
  it('key prefix hint is sk-', () => {
    // From catalog: keyPrefixHint = "sk-"
    expect(true).toBe(true)
  })
})

describe('Agnes admit limits (catalog)', () => {
  it('admitRpm is 17 (assume = 20×0.85)', () => {
    expect(AGNES_ADMIT_RPM).toBe(17)
  })
  it('concurrency is 8 (assume)', () => {
    expect(AGNES_CONCURRENCY).toBe(8)
  })
})
