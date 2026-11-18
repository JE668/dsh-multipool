import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import {
  AccountGate,
  computeBudget,
  DEFAULT_AMD_POLICY,
  type AdmissionPolicy,
} from '../src/admission.js'
import { AMD_CONCURRENCY_KEY_ADMIT, AMD_CONCURRENCY_KEY_HARD } from '../src/limits.js'

const policy = (over: Partial<AdmissionPolicy> = {}): AdmissionPolicy => ({
  ...DEFAULT_AMD_POLICY,
  ...over,
})

describe('A-03 budget is the min of both documented ceilings', () => {
  it('binds on the account 20, not the Key 30', () => {
    const budget = computeBudget({ policy: policy() })
    expect(budget.admitRpm).toBe(11)
    expect(budget.sources[0]).toContain('min(20,30)')
  })

  it('a Key ceiling below the account ceiling lowers the budget', () => {
    const budget = computeBudget({ policy: policy({ rpmKey: 10 }) })
    expect(budget.admitRpm).toBe(5)
  })

  it('no header -> no calibration source', () => {
    const budget = computeBudget({ policy: policy() })
    expect(budget.sources.filter(s => s.includes('header'))).toHaveLength(0)
  })
})

describe('A-03 header calibration takes the min, never the max', () => {
  it('a lower remaining tightens the budget', () => {
    const gate = new AccountGate(createFakeClock({ now: 0 }), policy())
    gate.observeHeaders(3)
    expect(gate.currentBudget.admitRpm).toBe(3)
  })

  it('a high remaining does not lift the budget above the ceiling', () => {
    const gate = new AccountGate(createFakeClock({ now: 0 }), policy())
    gate.observeHeaders(30)
    expect(gate.currentBudget.admitRpm).toBe(11)
  })

  it('the operating concurrency ceiling stays under the hard cap', () => {
    expect(AMD_CONCURRENCY_KEY_ADMIT).toBeLessThan(AMD_CONCURRENCY_KEY_HARD)
  })
})

describe('A-15 three endpoints share ONE account window', () => {
  it('chat + speech + systemone count against the same bucket', () => {
    const clock = createFakeClock({ now: 1_000 })
    const gate = new AccountGate(clock, policy({ assumedExternalClients: 1 }))
    const budget = gate.currentBudget.admitRpm
    expect(budget).toBe(17)

    let admitted = 0
    const endpoints = ['/v1/chat/completions', '/v1/audio/speech', '/v1/systemone']
    for (let i = 0; i < budget; i += 1) {
      const path = endpoints[i % 3] as string
      if (gate.tryAcquire(path).ok) admitted += 1
      clock.advance(10)
    }
    expect(admitted).toBe(budget)

    // one more, on an endpoint never seen before, is refused: the bucket never knew which endpoint it was
    expect(gate.tryAcquire('/v1/messages').ok).toBe(false)
  })

  it('the shared window is 60s wide, not per endpoint', () => {
    const clock = createFakeClock({ now: 72_000_000 })
    const gate = new AccountGate(clock, policy())
    for (let i = 0; i < 11; i += 1) gate.tryAcquire('/v1/chat/completions')
    expect(gate.canAdmit(72_000_000)).toBe(false)
    clock.advance(60_001)
    expect(gate.canAdmit(72_060_001)).toBe(true)
  })
})
