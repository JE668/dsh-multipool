import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import { AccountGate, DEFAULT_AMD_POLICY } from '../src/admission.js'
import { AMD_RPM_ACCOUNT, AMD_WINDOW_MS } from '../src/limits.js'
import {
  countHits,
  recorded,
  resetUpstream,
  startFakeUpstream,
  type FakeUpstream,
} from './fixtures/fake-upstream.js'

let upstream: FakeUpstream

beforeAll(async () => {
  // The upstream enforces AMD's documented gateway counter: request 21 in a
  // 60 s window is a 429. Nothing here is a plugin stub; it is the whole point.
  upstream = await startFakeUpstream({ rpm: AMD_RPM_ACCOUNT })
})

afterAll(async () => {
  await upstream.close()
})

beforeEach(() => {
  resetUpstream()
})

describe('first batch acceptance: thirty requests, twenty through, no 429', () => {
  it('admits twenty of thirty and the upstream never had to refuse', async () => {
    const clock = createFakeClock({ now: 0 })
    // The gate hands out permissions; the requests are plain fetches so the
    // assertion runs against what the server actually received.
    const gate = new AccountGate(clock, DEFAULT_AMD_POLICY)

    let admitted = 0
    let deferred = 0
    const statuses: number[] = []

    for (let i = 0; i < 30; i += 1) {
      const reservation = gate.tryAcquire('/v1/chat/completions')
      if (reservation.ok) {
        admitted += 1
        const res = await fetch(`${upstream.url}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: 'Bearer rc-test', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'DeepSeek-V4-Flash', messages: [] }),
        })
        statuses.push(res.status)
      } else {
        deferred += 1
      }
      // 1 s between attempts: 30 attempts = 29 s, still inside one 60 s window
      clock.advance(1_000)
    }

    // The default policy discounts for clients the plugin cannot see (04 section 2.2:
    // 0.85 conservative factor over an assumed 1.5 external clients), so it spends 11
    // of the documented 20 and never probes the edge by sending 20.
    expect(admitted).toBe(11)
    expect(deferred).toBe(19)
    expect(statuses.filter(status => status === 429)).toEqual([])
    expect(countHits('/v1/chat/completions')).toBe(11)
    expect(recorded().length).toBe(11)
  })

  it('thirty with no gate would have been refused: the counter is real', async () => {
    let refused = 0
    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(`${upstream.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer rc-ungated', 'content-type': 'application/json' },
        body: '{}',
      })
      if (res.status === 429) refused += 1
    }
    expect(refused).toBe(10)
  })
})

