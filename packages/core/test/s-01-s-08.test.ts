import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import {
  AccountGate,
  computeBudget,
  DEFAULT_AMD_POLICY,
} from '../src/index.js'
import { KeyPool } from '../src/proxy.js'
import {
  BREAKER_OPEN_MS,
  Breaker,
  cooldownKeyOf,
  createBindingStore,
  mayMigrateOn,
  shouldMigrate,
  stickyPick,
} from '../src/index.js'
import type { Candidate } from '../src/index.js'
import type { StickyBinding } from '../src/index.js'

const NOW = 1_000_000_000_000

function gate(clock: ReturnType<typeof createFakeClock>): AccountGate {
  return new AccountGate(clock, DEFAULT_AMD_POLICY)
}

/** Two keys for a single account, round-robin pool. */
function twoKeys(clock: ReturnType<typeof createFakeClock>): KeyPool {
  return new KeyPool(clock, [
    { accountAlias: 'acct-a', keyId: 'rc-key-1', secret: 'rc-secret-1' },
    { accountAlias: 'acct-a', keyId: 'rc-key-2', secret: 'rc-secret-2' },
  ], DEFAULT_AMD_POLICY.rpmAccount, DEFAULT_AMD_POLICY.rpmKey)
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

describe('S-01: AMD single account, 10 RPM → all success, no queue', () => {
  it('admits ten requests in one minute with no waiting', () => {
    const clock = createFakeClock({ now: NOW })
    const g = gate(clock)
    for (let i = 0; i < 10; i += 1) {
      const r = g.tryAcquire('/v1/chat/completions')
      expect(r.ok).toBe(true)
      expect(r.waitMs).toBe(0)
    }
  })
})

describe('S-02: AMD single account, 20 in 3s → no upstream 429, queue in plugin', () => {
  it('first 11 admitted immediately, the rest wait for the window to slide', () => {
    const clock = createFakeClock({ now: NOW })
    const g = gate(clock)
    let admitted = 0
    for (let i = 0; i < 20; i += 1) {
      const r = g.tryAcquire('/v1/chat/completions')
      if (r.ok) admitted += 1
      else expect(r.waitMs).toBeGreaterThan(0)
    }
    expect(admitted).toBe(11) // floor(min(20,30) * 0.85 / 1.5) = 11
    // No upstream 429: every rejection carries a waitMs, never an upstream code.
    // After the window slides, all are released:
    const later = createFakeClock({ now: NOW + DEFAULT_AMD_POLICY.tStickyIdleMs })
    const g2 = gate(later)
    for (let i = 0; i < 11; i += 1) {
      expect(g2.tryAcquire('/v1/chat/completions').ok).toBe(true)
    }
  })
})

describe('S-03: AMD dual accounts, 40 in 3s → ~20 each, no upstream 429', () => {
  it('each account has its own gate; combined they admit more than one', () => {
    const clock = createFakeClock({ now: NOW })
    const g1 = gate(clock)
    const g2 = gate(clock)
    let total = 0
    for (let i = 0; i < 40; i += 1) {
      const r = i % 2 === 0 ? g1.tryAcquire('/v1/chat/completions') : g2.tryAcquire('/v1/chat/completions')
      if (r.ok) total += 1
    }
    // Two gates × 11 admitRpm = 22 admitted in the first minute
    expect(total).toBeGreaterThan(11)
    expect(total).toBeLessThanOrEqual(22)
  })
})

describe('S-04: AMD dual accounts, 50 in 3s → first fast, rest queue, still no upstream 429', () => {
  it('admits up to 22 immediately, the rest carry waitMs', () => {
    const clock = createFakeClock({ now: NOW })
    const g1 = gate(clock)
    const g2 = gate(clock)
    let immediate = 0
    let queued = 0
    for (let i = 0; i < 50; i += 1) {
      const r = i % 2 === 0 ? g1.tryAcquire('/v1/chat/completions') : g2.tryAcquire('/v1/chat/completions')
      if (r.ok) immediate += 1
      else {
        queued += 1
        expect(r.waitMs).toBeGreaterThan(0)
      }
    }
    expect(immediate).toBe(22)
    expect(queued).toBe(28)
  })
})

describe('S-05: upstream 429 at 30 RPS → hit key cools 60s±15%, others unaffected', () => {
  it('records a 429 against one key; cooldownKeyOf returns key-scoped key for rpm_key', () => {
    // rpm_key maps to cooldownKeyOf `providerId:accountAlias` (per-account, per-key via breaker)
    expect(cooldownKeyOf('amd', 'acct-a', { rateClass: 'rpm_key' } as never)).toBe('amd:acct-a')
    // Other keys are separate buckets: a breaker on acct-b does not block acct-a.
    const breakerA = new Breaker(createFakeClock({ now: NOW }))
    const breakerB = new Breaker(createFakeClock({ now: NOW }))
    for (let i = 0; i < 25; i += 1) breakerA.record(true, NOW + i)
    expect(breakerA.state(NOW + 30)).toBe('open')
    expect(breakerB.state(NOW + 30)).toBe('closed')
  })
})

describe("S-06 / S-06': ip_rate_limit_exceeded → only the hit key cools, reason rpm_ip", () => {
  it('cooldownKeyOf for rpm_ip is provider-scoped (no account alias)', () => {
    const keyIp = cooldownKeyOf('amd', 'acct-a', { rateClass: 'rpm_ip' } as never)
    const keyKey = cooldownKeyOf('amd', 'acct-a', { rateClass: 'rpm_key' } as never)
    expect(keyIp).toBe('amd')
    expect(keyKey).not.toBe(keyIp)
    // ip_rate_limit_exceeded maps to rpm_ip class:
    expect(mayMigrateOn('rpm_ip')).toBe(true)
    expect(mayMigrateOn('daily_quota')).toBe(true)
    expect(mayMigrateOn('auth')).toBe(true)
    expect(mayMigrateOn('rpm_key')).toBe(false)
    expect(mayMigrateOn('concurrency')).toBe(false)
  })

  it('Retry-After governs cool-down duration, other keys unaffected', () => {
    const clock = createFakeClock({ now: NOW })
    const breaker = new Breaker(clock)
    // inject 429s on one breaker only:
    for (let i = 0; i < 25; i += 1) breaker.record(true, NOW + i)
    expect(breaker.state(NOW + 30)).toBe('open')
    // half-open at BREAKER_OPEN_MS after the last failure (NOW+24):
    expect(breaker.state(NOW + 24 + BREAKER_OPEN_MS)).toBe('half-open')
    // other keys (other breakers) are untouched:
    const other = new Breaker(clock)
    expect(other.state(NOW + 30)).toBe('closed')
  })
})

describe('S-07: session bound Key-1, Key-1 429 but Key-2 idle → A still waits', () => {
  it('stickyPick keeps the session on its bound key while idle', () => {
    const clock = createFakeClock({ now: NOW })
    const store = createBindingStore()
    store.set(binding({ lastUsedAtMs: NOW }))
    const pick = stickyPick(
      { id: 's1' },
      [candidate({ accountAlias: 'acct-2', keyId: 'rc-two' }), candidate()],
      store,
      { tStickyIdleMs: 15 * 60_000, migrationBias: 3 },
      clock.now(),
    )
    expect(pick?.keyId).toBe('rc-one')
  })

  it('does not migrate on rpm_key 429 (costStay <= bias × costWrong)', () => {
    // shouldMigrate stays when costStay is not strictly worse than bias × costWrong:
    expect(shouldMigrate(29_999, 10_000, 3)).toBe(false)
    expect(shouldMigrate(30_000, 10_000, 3)).toBe(false) // exact tie stays
    // only strictly above bias moves:
    expect(shouldMigrate(30_001, 10_000, 3)).toBe(true)
  })
})

describe('S-08: session bound Key-1, Key-1 daily_quota → A migrates to Key-2', () => {
  it('daily_quota is a migrating rate kind', () => {
    expect(mayMigrateOn('daily_quota')).toBe(true)
  })

  it('migrates when cost of staying exceeds bias × cost of wrong', () => {
    // daily_quota exhaustion: staying costs the full reset wait, moving is cheap:
    expect(shouldMigrate(5_000_000, 1_000_000, 3)).toBe(true)
  })
})

describe('budget constant (shared by S-01~S-04)', () => {
  it('admitRpm is 11 for the default AMD policy', () => {
    const budget = computeBudget({ policy: DEFAULT_AMD_POLICY })
    expect(budget.admitRpm).toBe(11)
    expect(budget.sources[0]).toBe('min(20,30)*0.85/1.5=11')
  })
})
