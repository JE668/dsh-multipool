import { describe, expect, it } from 'vitest'
import type { Account, MetricsEvent, ProviderId } from '../src/contract.js'
import { ALL_PROVIDERS, buildSnapshot, serializeSnapshot, sourcedNumberFromWire, toClientAccount } from '../src/snapshot.js'

const NOW = Date.UTC(2026, 10, 19, 2, 0, 0)
const PROVIDERS: readonly ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

function acct(
  providerId: ProviderId,
  alias: string,
  status: Account['status'],
  extra: Partial<Account> = {},
): Account {
  return {
    providerId,
    accountAlias: alias,
    keyIdMasked: `${providerId}-\u20261a2b`,
    enabled: true,
    limits: {},
    status,
    ...extra,
  }
}

function ev(providerId: ProviderId, status: number, agoMs: number, rateKind?: MetricsEvent['rateKind']): MetricsEvent {
  return {
    ts: NOW - agoMs,
    providerId,
    accountAlias: 'a',
    keyIdMasked: 'k',
    modelId: 'm',
    requestId: 'r',
    status,
    latencyMs: 1,
    attempt: 1,
    concurrencyAtSend: 1,
    ...(rateKind === undefined ? {} : { rateKind }),
  }
}

describe('T-2-a snapshot built on the host', () => {
  it('counts available over total and marks a fully empty pool as not configured', () => {
    const snap = buildSnapshot(
      { accounts: [], events: [], nowMs: NOW, activeSessions: 0, queued: 0 },
      PROVIDERS,
    )
    expect(snap.overall.available).toBe(0)
    expect(snap.overall.total).toBe(0)
    expect(snap.overall.configured).toBe(false)
    expect(snap.overall.providerId).toBe(ALL_PROVIDERS)
    expect(snap.providers.map((p) => p.providerId)).toEqual([...PROVIDERS])
    expect(snap.providers.every((p) => p.tally.total === 0)).toBe(true)
  })

  it('does not count a cooling or disabled account as available', () => {
    const snap = buildSnapshot(
      {
        accounts: [
          acct('amd', 'AMD-A', 'available'),
          acct('amd', 'AMD-B', 'rate_limited', { coolUntil: NOW + 41_000, cooldownReason: 'rpm_key' }),
          acct('amd', 'AMD-C', 'disabled'),
          acct('nim', 'NV-1', 'quota_unknown'),
        ],
        events: [],
        nowMs: NOW,
        activeSessions: 0,
        queued: 0,
      },
      PROVIDERS,
    )
    expect(snap.overall).toMatchObject({ available: 1, total: 4, configured: true })
    expect(snap.providers.find((p) => p.providerId === 'amd')?.tally).toEqual({ available: 1, total: 3 })
    expect(snap.cooling).toEqual([{ providerId: 'amd', accountAlias: 'AMD-B', rateKind: 'rpm_key', untilMs: NOW + 41_000 }])
  })

  it('reports nothing yet as a null rate rather than zero percent', () => {
    const snap = buildSnapshot({ accounts: [], events: [], nowMs: NOW, activeSessions: 0, queued: 0 }, PROVIDERS)
    expect(snap.last5m).toEqual({ requests: 0, err429: 0, rate: null })
  })

  it('keeps the 429 rate as a decimal string with its assumption spelled out', () => {
    const snap = buildSnapshot(
      {
        accounts: [],
        events: [ev('amd', 200, 1000), ev('amd', 200, 2000), ev('amd', 200, 3000), ev('amd', 429, 69_999, 'rpm_key')],
        nowMs: NOW,
        activeSessions: 0,
        queued: 0,
      },
      PROVIDERS,
    )
    expect(snap.last5m.requests).toBe(4)
    expect(snap.last5m.rate?.value).toBe('25.00')
    expect(snap.last5m.rate?.source).toBe('assume')
  })

  it('leaves a provider without a usage endpoint unavailable and without numbers', () => {
    const snap = buildSnapshot({ accounts: [], events: [], nowMs: NOW, activeSessions: 0, queued: 0 }, PROVIDERS)
    const nim = snap.providers.find((p) => p.providerId === 'nim')
    expect(nim?.usageAvailable).toBe(false)
    expect(nim?.dailyUsedPts).toBeUndefined()
    expect(nim?.dailyLimitPts).toBeUndefined()
    expect(nim?.dailyResetAt).toBeUndefined()
  })

  it('never serialises a whole key', () => {
    const snap = buildSnapshot(
      { accounts: [acct('amd', 'AMD-A', 'available')], events: [], nowMs: NOW, activeSessions: 2, queued: 1 },
      PROVIDERS,
    )
    const wire = serializeSnapshot(snap)
    expect(wire).toContain('1a2b')
    expect(wire).not.toContain('rc-SECRET')
    expect(wire).toContain('"activeSessions":2')
  })
})

describe('snapshot wire guards', () => {
  it('drops an account record whose secret field sneaks onto the object', () => {
    const leaky = { ...acct('amd', 'AMD-A', 'available'), secret: 'rc-SECRETVALUE1234' } as Account
    const projected = toClientAccount(leaky)
    expect(JSON.stringify(projected)).not.toContain('rc-SECRETVALUE1234')
    expect(Object.keys(projected).sort()).toEqual(
      ['accountAlias', 'enabled', 'keyIdMasked', 'providerId', 'status'],
    )
  })

  it('refuses a number that did not arrive sourced', () => {
    expect(sourcedNumberFromWire(11)).toBeNull()
    expect(sourcedNumberFromWire(null)).toBeNull()
    expect(sourcedNumberFromWire({ value: '11', source: 'api' })).toBeNull()
    expect(sourcedNumberFromWire({ value: Number.NaN, source: 'api' })).toBeNull()
    const good = sourcedNumberFromWire({ value: 11, source: 'api' })
    expect(good?.value).toBe(11)
    expect(good?.source).toBe('api')
  })
})
