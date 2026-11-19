import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import { AccountGate, DEFAULT_AMD_POLICY, computeBudget } from '../src/admission.js'
import { AMD_RPM_ACCOUNT, AMD_RPM_KEY, AMD_WINDOW_MS } from '../src/limits.js'

/** One account, one plugin: no outside clients to discount for. */
function oneClientPolicy() {
  return { ...DEFAULT_AMD_POLICY, assumedExternalClients: 1, conservativeFactor: 1 }
}

describe('A-01 the gate says no before the upstream has to', () => {
  it('admits exactly twenty of thirty requests inside one window', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, oneClientPolicy())
    expect(gate.currentBudget.admitRpm).toBe(20)

    let admitted = 0
    let queued = 0
    for (let i = 0; i < 30; i += 1) {
      const reservation = gate.tryAcquire('/v1/chat/completions')
      if (reservation.ok) {
        admitted += 1
      } else {
        queued += 1
        expect(reservation.waitMs).toBeGreaterThan(0)
        expect(reservation.waitMs).toBeLessThanOrEqual(AMD_WINDOW_MS)
      }
      clock.advance(1_000)
    }

    expect(admitted).toBe(20)
    expect(queued).toBe(10)
  })

  it('shares the twenty with speech and systemone', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, oneClientPolicy())
    const paths = ['/v1/chat/completions', '/v1/audio/speech', '/v1/systemone']
    let admitted = 0
    for (let i = 0; i < 30; i += 1) {
      if (gate.tryAcquire(paths[i % 3] ?? '/v1/chat/completions').ok) admitted += 1
      clock.advance(500)
    }
    expect(admitted).toBe(20)
  })
})

describe('A-02 the budget stays inside the coefficients it was built from', () => {
  it('is eleven, and never more than thirteen', () => {
    const budget = computeBudget({ policy: DEFAULT_AMD_POLICY })
    expect(budget.admitRpm).toBeGreaterThanOrEqual(11)
    expect(budget.admitRpm).toBeLessThanOrEqual(13)
  })

  it('a hundred requests in thirty seconds never admit more than the budget', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    const budget = gate.currentBudget.admitRpm
    let admitted = 0
    for (let i = 0; i < 100; i += 1) {
      if (gate.tryAcquire('/v1/chat/completions').ok) admitted += 1
    }
    expect(admitted).toBe(budget)
  })

  it('the ceiling is the account twenty, not the key thirty', () => {
    const budget = computeBudget({ policy: DEFAULT_AMD_POLICY })
    expect(budget.sources[0]).toContain('min(20,30)')
    expect(budget.admitRpm).toBeLessThan(AMD_RPM_KEY)
  })
})

describe('A-18 a header can only lower the budget', () => {
  it('ignores a header that would raise it', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    const before = gate.currentBudget.admitRpm
    gate.observeHeaders(30)
    expect(gate.currentBudget.admitRpm).toBe(before)
    gate.observeHeaders(null)
    expect(gate.currentBudget.admitRpm).toBe(before)
  })

  it('follows a header that lowers it', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    gate.observeHeaders(3)
    expect(gate.currentBudget.admitRpm).toBe(3)
  })
})

describe('AccountGate.peekWait: the queue view, which spends nothing', () => {
  it('says zero while there is room, and does not take the room', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    for (let i = 0; i < 3; i += 1) expect(gate.peekWait(clock.now())).toBe(0)
    expect(gate.tryAcquire('/v1/chat/completions').ok).toBe(true)
    expect(gate.peekWait(clock.now())).toBe(0)
  })

  it('reports the wait the next reservation would really be given', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    let admitted = 0
    while (gate.tryAcquire('/v1/chat/completions').ok) admitted += 1
    const wait = gate.peekWait(clock.now())
    const reservation = gate.tryAcquire('/v1/chat/completions')
    expect(reservation.ok).toBe(false)
    expect(reservation.waitMs).toBe(wait)
    expect(wait).toBeGreaterThan(0)
    expect(admitted).toBeGreaterThan(0)
  })

  it('forgets an empty queue, so a cleared gate admits everything again', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)
    // two different endpoints, the one window: switching family frees nothing
    while (gate.tryAcquire('/v1/chat/completions').ok) clock.advance(0)
    while (gate.tryAcquire('/v1/systemone').ok) clock.advance(0)
    expect(gate.canAdmit(clock.now())).toBe(false)
    gate.clear()
    expect(gate.canAdmit(clock.now())).toBe(true)
    expect(gate.peekWait(clock.now())).toBe(0)
  })
})
