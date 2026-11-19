import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '@dsh-multipool/core'
import type { Account, MetricsEvent, ProviderId, Snapshot, UsageResult } from '@dsh-multipool/core'
import { NO_VALUE, accountsLine, badgeTextOf, iconLevelOf, iconViewOf, pointsLine, rpmLine } from './icon-state.js'

const NOW = 1_764_000_000_000
const PROVIDERS: readonly ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

function acct(providerId: ProviderId, alias: string, status: Account['status']): Account {
  return {
    providerId,
    accountAlias: alias,
    keyIdMasked: providerId + '-\u20261a2b',
    enabled: true,
    limits: {},
    status,
  }
}

function usage(partial: Partial<UsageResult>): UsageResult {
  return { available: true, ...partial }
}

function snap(accounts: Account[], events: MetricsEvent[] = [], usage: Partial<Record<ProviderId, UsageResult>> = {}): Snapshot {
  return buildSnapshot({ accounts, events, nowMs: NOW, activeSessions: 1, queued: 0, usage }, PROVIDERS)
}

function providerOf(s: Snapshot, providerId: ProviderId) {
  const found = s.providers.find((p) => p.providerId === providerId)
  if (found === undefined) throw new Error('provider missing from snapshot: ' + providerId)
  return found
}

const BUDGET = { admitRpm: 11, sources: ['min(20,30)*0.85/1.5=11'] }
const DASH = NO_VALUE

describe('T-2-b icon shape follows the four states', () => {
  it('grey when every provider is empty', () => {
    const s = snap([])
    expect(iconLevelOf(s.overall, s.overall.configured)).toBe('grey')
    expect(badgeTextOf({ available: s.overall.available, total: s.overall.total })).toBe('0/0')
  })

  it('green when all accounts are usable', () => {
    const s = snap([acct('amd', 'A', 'available'), acct('nim', 'B', 'available')])
    expect(iconLevelOf(s.overall, s.overall.configured)).toBe('green')
  })

  it('yellow when some but not all are usable, red when none is', () => {
    const y = snap([acct('amd', 'A', 'available'), acct('amd', 'B', 'rate_limited')])
    expect(iconLevelOf(y.overall, y.overall.configured)).toBe('yellow')
    const r = snap([acct('amd', 'B', 'rate_limited'), acct('nim', 'C', 'quota_exhausted')])
    expect(iconLevelOf(r.overall, r.overall.configured)).toBe('red')
    expect(badgeTextOf({ available: r.overall.available, total: r.overall.total })).toBe('0/2')
  })

  it('counts a quota of unknown size as not usable', () => {
    const s = snap([acct('amd', 'A', 'available'), acct('agnes', 'nou', 'quota_unknown')])
    expect(iconLevelOf(s.overall, s.overall.configured)).toBe('yellow')
  })
})

describe('provider lines print an em dash, not a zero', () => {
  it('has no 0/0 anywhere', () => {
    const line = accountsLine(snap([acct('amd', 'A', 'available')]))
    expect(line).toContain('AMD 1')
    expect(line).not.toContain('0/0')
    expect(line).not.toContain('NIM 0')
  })

  it('dashes a provider with no accounts at all', () => {
    const line = accountsLine(snap([acct('sensenova', 'S', 'available'), acct('sensenova', 'T', 'rate_limited')]))
    expect(line).toContain('SenseNova 1')
    expect(line).toContain('AMD ' + DASH)
  })
})

describe('pts line three says what upstream said or nothing', () => {
  it('carries the fetched values', () => {
    const s = snap([acct('amd', 'A', 'available')], [], {
      amd: usage({
        dailyUsedPts: { value: 5.81, source: 'api' },
        dailyLimitPts: { value: 40, source: 'api' },
      }),
    })
    expect(pointsLine(providerOf(s, 'amd'), null)).toContain('5.81 / 40')
  })

  it('marks a remembered reading with the moment it was fetched', () => {
    const s = snap([acct('amd', 'A', 'available')], [], {
      amd: usage({
        dailyUsedPts: { value: 4.19, source: 'api' },
        dailyLimitPts: { value: 10, source: 'api' },
      }),
    })
    const line = pointsLine(providerOf(s, 'amd'), '09:41')
    expect(line).toContain('4.19 / 10')
    expect(line).toContain('09:41')
  })

  it('shows no figures at all when the endpoint has never answered', () => {
    const s = snap([acct('nim', 'N', 'available')])
    const line = pointsLine(providerOf(s, 'nim'), null)
    expect(line).toContain(DASH)
    expect(line).not.toContain(' / ')
    expect(line).not.toMatch(/\d/)
  })
})

describe('rpm line keeps the formula on screen', () => {
  it('prints the budget beside the arithmetic that produced it', () => {
    const line = rpmLine(BUDGET)
    expect(line).toContain('11')
    expect(line).toContain('0.85')
  })
})

describe('iconViewOf wires the three lines together', () => {
  it('builds a full view for a partially cooling pool', () => {
    const s = snap(
      [acct('amd', 'A', 'available'), acct('amd', 'B', 'rate_limited')],
      [],
      { amd: usage({ dailyUsedPts: { value: 4.19, source: 'api' }, dailyLimitPts: { value: 189, source: 'api' } }) },
    )
    const view = iconViewOf({ snapshot: s, budget: BUDGET, pointsProviderId: 'amd' })
    expect(view.level).toBe('yellow')
    expect(view.badge).toBe('1/2')
    expect(view.lines.accounts).toContain('1/2')
    expect(view.lines.rpm).toContain('11')
    expect(view.lines.points).toContain('4.19')
  })

  it('still renders a points line when no provider was chosen', () => {
    const view = iconViewOf({ snapshot: snap([acct('amd', 'A', 'available')]), budget: BUDGET, pointsProviderId: null })
    expect(view.lines.points).toContain(DASH)
  })
})

describe('attached: a host that never answered is not an empty pool', () => {
  const unattached = (s: Snapshot) =>
    iconViewOf({ snapshot: s, budget: BUDGET, pointsProviderId: null, attached: false })

  it('dashes the badge instead of claiming 0/0', () => {
    const view = unattached(snap([]))
    expect(view.badge).toBe(DASH + '/' + DASH)
    expect(view.attached).toBe(false)
    expect(view.level).toBe('grey')
  })

  it('dashes the budget and says why, where a configured pool would print 0', () => {
    const view = unattached(snap([]))
    expect(view.lines.rpm).toContain(DASH)
    expect(view.lines.rpm).not.toContain("0")
    expect(view.lines.rpm).toContain('host')
  })

  it('says nothing about points either', () => {
    const view = unattached(snap([]))
    expect(view.lines.points).toBe('\u4eca\u65e5 pts ' + DASH)
    expect(view.lines.points).not.toMatch(/\d/)
  })

  it('keeps the ordinary 0/0 for a host that did answer with no keys', () => {
    const view = iconViewOf({ snapshot: snap([]), budget: BUDGET, pointsProviderId: null })
    expect(view.attached).toBe(true)
    expect(view.badge).toBe('0/0')
  })
})
