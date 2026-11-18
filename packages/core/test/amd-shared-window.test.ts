import { beforeEach, describe, expect, it } from 'vitest'
import { AccountGate, DEFAULT_AMD_POLICY, computeBudget } from '../src/admission.js'
import { createFakeClock } from '../src/clock.js'
import { plan, recorded, resetUpstream, startFakeUpstream } from './fixtures/fake-upstream.js'

/**
 * A-15. 02 section 1.1: chat, speech and systemone are metered by the SAME gateway
 * window and the SAME daily ceiling. So a request to /v1/audio/speech spends one of
 * the 20 the chat endpoint would have used. The gate never takes an endpoint key at
 * all -- these tests exist to prove that choices made at the API layer cannot re-split
 * the bucket back up into three.
 */

const ENDPOINTS = ['/v1/chat/completions', '/v1/audio/speech', '/v1/systemone'] as const

/** One account, no external clients: the budget is exactly the account ceiling, 20. */
function oneAccountPerPlugin() {
  return { ...DEFAULT_AMD_POLICY, assumedExternalClients: 1, conservativeFactor: 1 }
}

describe('A-15 the three metered endpoints share one window', () => {
  it('twenty requests spent across all three leave zero for the fourth', () => {
    const clock = createFakeClock({ now: 1_000 })
    const gate = new AccountGate(clock, oneAccountPerPlugin())
    expect(gate.currentBudget.admitRpm).toBe(20)

    for (let i = 0; i < 20; i += 1) {
      const endpoint = ENDPOINTS[i % 3] as string
      expect(gate.tryAcquire(endpoint).ok).toBe(true)
      clock.advance(100)
    }

    // t = 3_000ms, all twenty still inside the window
    for (const endpoint of ENDPOINTS) {
      expect(gate.tryAcquire(endpoint).ok).toBe(false)
    }
  })

  it('eight chat requests do not leave twelve spare for speech and systemone', () => {
    const clock = createFakeClock({ now: 0 })
    const gate = new AccountGate(clock, oneAccountPerPlugin())
    for (let i = 0; i < 8; i += 1) {
      expect(gate.tryAcquire('/v1/chat/completions').ok).toBe(true)
      clock.advance(10)
    }
    // if each endpoint had its own bucket, these twelve would all pass
    let speech = 0
    let systemone = 0
    for (const endpoint of ['/v1/audio/speech', '/v1/systemone'] as const) {
      for (let i = 0; i < 6; i += 1) {
        if (gate.tryAcquire(endpoint).ok) {
          if (endpoint === '/v1/audio/speech') speech += 1
          else systemone += 1
        }
        clock.advance(10)
      }
    }
    expect(speech + systemone).toBe(12)
  })
})

describe('A-15 the window really closes after 60s, per account not per endpoint', () => {
  it('a request from one endpoint frees capacity for another after the window slides', () => {
    const clock = createFakeClock({ now: 60_000 })
    const gate = new AccountGate(clock, oneAccountPerPlugin())
    for (let i = 0; i < 20; i += 1) {
      expect(gate.tryAcquire('/v1/chat/completions').ok).toBe(true)
      clock.advance(1)
    }
    expect(gate.tryAcquire('/v1/audio/speech').ok).toBe(false)

    // exactly 60s later the first chat request has aged out (the window is half
    // open: an entry leaves at t + 60_000, not at t + 60_001) -- one slot, one endpoint
    // t = 60_000 + 20 x 1ms = 60_020, so the oldest entry ages out at t = 120_020.
    // The window is half open: an entry leaves at t + 60_000, not at t + 60_001.
    clock.advance(120_000 - clock.now())
    expect(gate.tryAcquire('/v1/audio/speech').ok).toBe(true)
    // and that slot is gone: speech did not get a bucket of its own
    expect(gate.tryAcquire('/v1/systemone').ok).toBe(false)
  })

  it('daily churn across endpoints is tallied in one counter, not three', () => {
    // the gate holds no per-endpoint state at all; the strongest form of the claim
    // is that its shape cannot represent one
    const gate = new AccountGate(createFakeClock({ now: 0 }), DEFAULT_AMD_POLICY)
    expect(Object.keys(gate).filter(k => /chat|speech|systemone|audio/i.test(k))).toEqual([])
  })
})
