import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import {
  BREAKER_OPEN_MS,
  Breaker,
  LEAST_LOAD_WEIGHTS,
  type Candidate,
  leastLoad,
  leastLoadScore,
  mayMigrateOn,
  shouldMigrate,
  stickyPick,
  createBindingStore,
  type StickyBinding,
} from '../src/index.js'
import { DEFAULT_AMD_POLICY } from '../src/admission.js'

// trip() feeds 25 samples: five clean ones (1_000..1_004), then twenty 429s (1_005..1_024).
// The 25th is the one that closes over 0.5, so TRIP_AT_MS is where the breaker really opened.
const TRIP_AT_MS = 1_024
const HALF_OPEN_AT_MS = TRIP_AT_MS + BREAKER_OPEN_MS

/** A breaker that has actually tripped -- 20 of its last 25 samples are 429s. */
function trip(): Breaker {
  const breaker = new Breaker(createFakeClock({ now: 0 }))
  for (let i = 0; i < 5; i += 1) breaker.record(false, 1_000 + i)
  for (let i = 0; i < 20; i += 1) breaker.record(true, 1_005 + i)
  return breaker
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    accountAlias: 'acct-1',
    keyId: 'rc-one',
    modelId: 'DeepSeek-V4-Flash',
    rpmLimit: 20,
    rpmUsed: 0,
    inFlight: 0,
    concurrencyLimit: 6,
    ...over,
  }
}

describe('breakers', () => {
  it('stays closed while exactly half of a full window failed', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 10; i += 1) breaker.record(true, 1_000)
    for (let i = 0; i < 10; i += 1) breaker.record(false, 1_000)
    expect(breaker.snapshot(1_000)).toEqual({ state: 'closed', samples: 20, errors429: 10 })
  })

  it('trips when more than half of a full window is 429', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 10; i += 1) breaker.record(true, 1_000)
    for (let i = 0; i < 9; i += 1) breaker.record(false, 1_000)
    breaker.record(true, 1_000)
    expect(breaker.snapshot(1_000).state).toBe('open')
  })

  it('does not judge a short burst: the ratio needs a full window', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 19; i += 1) breaker.record(true, 1_000)
    expect(breaker.snapshot(1_000).state).toBe('closed')
    breaker.record(true, 1_000)
    expect(breaker.snapshot(1_000).state).toBe('open')
  })

  it('lifts into half-open at 30s, and not a hair before', () => {
    const breaker = trip()
    expect(breaker.state(TRIP_AT_MS)).toBe('open')
    expect(breaker.state(HALF_OPEN_AT_MS - 1)).toBe('open')
    expect(breaker.state(HALF_OPEN_AT_MS)).toBe('half-open')
  })

  it('half-open admits one probe and nobody else', () => {
    const breaker = trip()
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    // the verdict has not come back yet: everyone else behind the probe waits for it
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(false)
    expect(breaker.admit(HALF_OPEN_AT_MS + 60_000)).toBe(false)
  })

  it('a successful probe closes it', () => {
    const breaker = trip()
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    breaker.record(false, HALF_OPEN_AT_MS + 1)
    expect(breaker.state(HALF_OPEN_AT_MS + 2)).toBe('closed')
    expect(breaker.admit(HALF_OPEN_AT_MS + 2)).toBe(true)
  })

  it('a failed probe starts a fresh 30s from the failure', () => {
    const breaker = trip()
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    breaker.record(true, HALF_OPEN_AT_MS)
    expect(breaker.state(HALF_OPEN_AT_MS + BREAKER_OPEN_MS - 1)).toBe('open')
    expect(breaker.state(HALF_OPEN_AT_MS + BREAKER_OPEN_MS)).toBe('half-open')
  })

  it('after a passed probe the window restarts from that one sample, not from the old 429s', () => {
    // The probe clears the history, so 19 records later (18 of them failures -- still under
    // BREAKER_MIN_SAMPLES) nothing has tripped: a welded breaker would be shut for good here.
    const breaker = trip()
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    breaker.record(false, HALF_OPEN_AT_MS)
    expect(breaker.snapshot(HALF_OPEN_AT_MS).samples).toBe(1)
    for (let i = 0; i < 18; i += 1) breaker.record(true, HALF_OPEN_AT_MS + 1 + i)
    expect(breaker.state(HALF_OPEN_AT_MS + 19)).toBe('closed')
    // one more failure is a full window again, and 19/20 goes over at once
    breaker.record(true, HALF_OPEN_AT_MS + 19)
    expect(breaker.state(HALF_OPEN_AT_MS + 19)).toBe('open')
  })

  it('a sample older than 5 minutes drops out, even though the window is not full yet', () => {
    // 04 section 4 says the window is "the last 5 minutes OR the last 20 samples" -- the
    // first rule on its own already throws stale samples away. Twenty 429s at 1_000 trip it;
    // five calls ten minutes later plus fifteen more bring the total to forty with only
    // twenty of them inside the window, all clean, so it closes again through the top-20 rule
    // rather than through any age-based rescue.
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, 1_000)
    expect(breaker.snapshot(1_000).state).toBe('open')
    breaker.reset()
    for (let i = 0; i < 19; i += 1) breaker.record(true, 1_000)
    const later = 1_000 + 10 * 60_000
    for (let i = 0; i < 20; i += 1) breaker.record(false, later + i)
    expect(breaker.snapshot(later + 19).state).toBe('closed')
    // 19 stale 429s are still in the ring when a clean window arrives: 19 kept, 1 fresh
    expect(breaker.snapshot(later + 19).samples).toBe(20)
  })

  it('reset() forgets the samples, the open instant and the probe', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    breaker.reset()
    expect(breaker.snapshot().state).toBe('closed')
    expect(breaker.snapshot().samples).toBe(0)
    expect(breaker.admit()).toBe(true)
  })
})

describe('leastLoad', () => {
  it('scores an idle account at zero and a loaded one above', () => {
    const context = { session: { id: 's' }, nowMs: 10_000 }
    expect(leastLoadScore(candidate(), context)).toBe(0)
    expect(leastLoadScore(candidate({ rpmUsed: 18, inFlight: 6 }), context)).toBeGreaterThan(0)
  })

  it('rewards a success inside the last 60s by exactly the weight', () => {
    const at = 100_000
    const context = { session: { id: 's' }, nowMs: at }
    const plain = leastLoadScore(candidate(), context)
    expect(plain - leastLoadScore(candidate({ lastSuccessAtMs: at - 59_999 }), context))
      .toBeCloseTo(LEAST_LOAD_WEIGHTS.recentlySucceeded)
    expect(leastLoadScore(candidate({ lastSuccessAtMs: at - 60_000 }), context)).toBe(plain)
  })

  it('penalises the account the session just left', () => {
    const base = { session: { id: 's' }, nowMs: 1_000 }
    expect(leastLoadScore(candidate(), { ...base, migratedFrom: 'acct-1' }) - leastLoadScore(candidate(), base))
      .toBeCloseTo(LEAST_LOAD_WEIGHTS.lastMigrated)
  })

  it('picks the lowest score', () => {
    const pick = leastLoad(
      [
        candidate({ accountAlias: 'a', rpmUsed: 9 }),
        candidate({ accountAlias: 'b', rpmUsed: 0 }),
        candidate({ accountAlias: 'c', rpmUsed: 4 }),
      ],
      { session: { id: 'c1' }, nowMs: 0 },
    )
    expect(pick?.accountAlias).toBe('b')
  })

  it('returns null when there is nothing to route to', () => {
    expect(leastLoad([], { session: { id: 'b1' }, nowMs: 0 })).toBeNull()
  })
})

describe('migration table', () => {
  it('only rpm_ip, daily_quota and auth may move a session', () => {
    for (const kind of ['rpm_ip', 'daily_quota', 'auth'] as const) expect(mayMigrateOn(kind)).toBe(true)
    for (const kind of ['rpm_key', 'concurrency', 'model_missing', 'rate_opaque', 'plan_credit'] as const) {
      expect(mayMigrateOn(kind)).toBe(false)
    }
  })

  it('AMD bias is 3.0', () => {
    expect(DEFAULT_AMD_POLICY.migrationBias).toBe(3)
  })
})


describe('sticky pick (04 section 3.2)', () => {
  const OPTIONS = { tStickyIdleMs: 15 * 60_000, migrationBias: 3 } as const

  function binding(over: Partial<StickyBinding> = {}): StickyBinding {
    return {
      sessionId: 's1',
      accountAlias: 'acct-1',
      keyId: 'rc-one',
      boundAtMs: 0,
      lastUsedAtMs: 0,
      ...over,
    }
  }

  it('returns nothing for a session that was never bound', () => {
    const store = createBindingStore()
    expect(stickyPick({ id: 's1' }, [candidate()], store, OPTIONS, 1_000)).toBeNull()
  })

  it('returns the bound key while it is still among the candidates', () => {
    const store = createBindingStore()
    store.set(binding())
    const pick = stickyPick(
      { id: 's1' },
      [candidate({ accountAlias: 'acct-2', keyId: 'rc-two' }), candidate()],
      store,
      OPTIONS,
      60_000,
    )
    expect(pick?.keyId).toBe('rc-one')
  })

  it('lets the binding go once its key has dropped out of the candidate set', () => {
    const store = createBindingStore()
    store.set(binding())
    const pick = stickyPick({ id: 's1' }, [candidate({ keyId: 'rc-two' })], store, OPTIONS, 60_000)
    expect(pick).toBeNull()
  })

  it('measures idleness from the last request, not from when the session was bound', () => {
    const store = createBindingStore()
    // bound long ago, but its last request is one second inside the idle window
    store.set(binding({ boundAtMs: 0, lastUsedAtMs: OPTIONS.tStickyIdleMs - 1_000 }))
    expect(stickyPick({ id: 's1' }, [candidate()], store, OPTIONS, OPTIONS.tStickyIdleMs))
      .not.toBeNull()
  })

  it('lets a binding go idle at the threshold, not a second after it', () => {
    const store = createBindingStore()
    store.set(binding({ lastUsedAtMs: 1_000 }))
    const now = 1_000 + OPTIONS.tStickyIdleMs
    expect(stickyPick({ id: 's1' }, [candidate()], store, OPTIONS, now)).toBeNull()
  })

  it('stays put for a while, then forgets when deleted, and gives nothing back', () => {
    const store = createBindingStore()
    store.set(binding({ sessionId: 's1' }))
    store.set(binding({ sessionId: 's2' }))
    store.delete('s1')
    expect(store.get('s1')).toBeUndefined()
    expect(store.get('s2')?.sessionId).toBe('s2')
  })
})

describe('migration is only worth it past the bias (04 section 3.4)', () => {
  it('stays when the cost of waiting is not yet worse than the bias allows', () => {
    expect(shouldMigrate(29_999, 10_000, 3)).toBe(false)
  })

  it('moves when waiting strictly exceeds costWrong times the bias', () => {
    expect(shouldMigrate(30_001, 10_000, 3)).toBe(true)
  })

  it('does not move on an exact tie', () => {
    expect(shouldMigrate(30_000, 10_000, 3)).toBe(false)
  })

  it('refuses to move on a non-finite cost or a non-positive bias', () => {
    expect(shouldMigrate(Number.POSITIVE_INFINITY, 10_000, 3)).toBe(false)
    expect(shouldMigrate(30_000, Number.NaN, 3)).toBe(false)
    expect(shouldMigrate(30_000, 10_000, 0)).toBe(false)
  })
})

describe('breaker, half-open verdicts (04 section 4)', () => {
  function tripped(): Breaker {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 5; i += 1) breaker.record(false, 1_000 + i)
    for (let i = 0; i < 20; i += 1) breaker.record(true, 1_000 + 5 + i)
    return breaker
  }

  it('a failed probe starts a fresh 30s from the failure', () => {
    const breaker = tripped()
    breaker.record(true, 1_000 + 19 + BREAKER_OPEN_MS)
    expect(breaker.state(1_000 + 19 + 2 * BREAKER_OPEN_MS - 1)).toBe('open')
    expect(breaker.state(1_000 + 19 + 2 * BREAKER_OPEN_MS)).toBe('half-open')
  })

  it('trips nineteen deep once a passing call is in the ledger, where twenty 429s would not have', () => {
    // Sixteen of the old 429s are still in the ledger when a passing call is stamped. The trip
    // count runs before the probe reconciles them out, and it has no exclude list: this call,
    // proven healthy one line earlier, counts as a sample that did not fail, not as a sample
    // that passed. So sixteen 429s, then a pass, then two more reaches 17/18 at the second of
    // those and 18/19 at the third. Nineteen clean 429s only do it by spending every sample,
    // and once there are twenty they lower to a tie at half and stay closed.
    const breaker = tripped()
    breaker.record(false, 1_000 + 20)
    breaker.record(true, 1_000 + 21)
    breaker.record(true, 1_000 + 22)
    expect(breaker.snapshot(1_000 + 23).state).toBe('open')
  })

  it('reset() forgets samples and the open instant', () => {
    const breaker = tripped()
    breaker.reset()
    expect(breaker.snapshot().state).toBe('closed')
    expect(breaker.snapshot().samples).toBe(0)
  })
})
