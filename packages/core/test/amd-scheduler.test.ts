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
} from '../src/index.js'
import { DEFAULT_AMD_POLICY } from '../src/admission.js'

// tripping() feeds 20 samples stamped 1_000 + i; the 20th is the one that closes over 0.5
const TRIP_AT_MS = 1_019
const HALF_OPEN_AT_MS = TRIP_AT_MS + BREAKER_OPEN_MS

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
    for (let i = 0; i < 11; i += 1) breaker.record(true, 1_000)
    for (let i = 0; i < 9; i += 1) breaker.record(false, 1_000)
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
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.state(TRIP_AT_MS)).toBe('open')
    expect(breaker.state(HALF_OPEN_AT_MS - 1)).toBe('open')
    expect(breaker.state(HALF_OPEN_AT_MS)).toBe('half-open')
  })

  it('half-open admits one probe and nobody else', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(false)
    expect(breaker.admit(HALF_OPEN_AT_MS + 60_000)).toBe(false)
  })

  it('a successful probe closes it', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    breaker.record(false, HALF_OPEN_AT_MS + 1)
    expect(breaker.state(HALF_OPEN_AT_MS + 2)).toBe('closed')
    expect(breaker.admit(HALF_OPEN_AT_MS + 2)).toBe(true)
  })

  it('a failed probe starts a fresh 30s from the failure', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    const failedAt = HALF_OPEN_AT_MS + 1
    breaker.record(true, failedAt)
    // the clock restarts at the failure, not at the original trip
    expect(breaker.state(failedAt + 1)).toBe('open')
    expect(breaker.admit(failedAt + BREAKER_OPEN_MS - 1)).toBe(false)
    expect(breaker.admit(failedAt + BREAKER_OPEN_MS)).toBe(true)
    expect(breaker.admit(failedAt + BREAKER_OPEN_MS)).toBe(false)
  })

  it('only one probe at a time: a second caller waits for the first verdict', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    expect(breaker.admit(HALF_OPEN_AT_MS + 1)).toBe(false)
  })

  it('stays closed after the probe, and only re-trips if failures rebuild', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 20; i += 1) breaker.record(true, TRIP_AT_MS)
    expect(breaker.snapshot(HALF_OPEN_AT_MS).state).toBe('half-open')
    // the probe has to be admitted before its verdict can close the breaker
    expect(breaker.admit(HALF_OPEN_AT_MS)).toBe(true)
    breaker.record(false, HALF_OPEN_AT_MS)
    expect(breaker.snapshot(HALF_OPEN_AT_MS).state).toBe('closed')

    // healthy traffic after the probe keeps it closed even though it is now in the window
    breaker.record(false, HALF_OPEN_AT_MS + 1)
    expect(breaker.snapshot(HALF_OPEN_AT_MS + 1).state).toBe('closed')

    // and a fresh window of 429s does take it down again
    for (let i = 2; i < 22; i += 1) breaker.record(true, HALF_OPEN_AT_MS + i)
    expect(breaker.snapshot(HALF_OPEN_AT_MS + 21).state).toBe('open')
  })

  it('a sample older than 5 minutes stops counting even inside the top 20', () => {
    const breaker = new Breaker(createFakeClock({ now: 0 }))
    for (let i = 0; i < 10; i += 1) breaker.record(true, 1_000)
    for (let i = 0; i < 10; i += 1) breaker.record(false, 1_000 + 5 * 60_000)
    expect(breaker.snapshot(1_000 + 5 * 60_000).state).toBe('closed')
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
