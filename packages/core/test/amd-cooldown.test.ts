import { describe, expect, it } from 'vitest'

import { accountAfterVerdict, cooldownKeyOf } from '../src/cooldown.js'
import type { Account } from '../src/contract.js'
import type { AmdVerdict } from '../src/amd-error.js'

const NOW = 1_700_000_000_000

const acct = (over: Partial<Account> = {}): Account => ({
  providerId: 'amd',
  accountAlias: 'AMD-A',
  keyIdMasked: 'rc-...1a2b',
  enabled: true,
  limits: {},
  status: 'available',
  ...over,
})

const verdict = (rateClass: AmdVerdict['rateClass'], retryAfterMs: number | null): AmdVerdict => ({
  rateClass,
  transport: rateClass === null ? 'ok' : 'unknown',
  retryAfterMs,
  diagnostic: { status: rateClass === null ? 200 : 429, raw: '', shell: 'detail-error' },
})
describe('A-07 one verdict reaches one account, and rpm_ip is not rpm_key', () => {
  it('cools the account that was told, for the Retry-After the upstream quoted', () => {
    const cooled = accountAfterVerdict(acct({ accountAlias: 'AMD-B' }), verdict('rpm_ip', 60_000), NOW)

    expect(cooled.status).toBe('rate_limited')
    expect(cooled.cooldownReason).toBe('rpm_ip')
    expect(cooled.coolUntil).toBe(NOW + 60_000)
  })

  it('keeps the IP bucket apart from the Key bucket', () => {
    const wall = accountAfterVerdict(acct(), verdict('rpm_ip', 60_000), NOW)
    const window = accountAfterVerdict(acct(), verdict('rpm_key', 60_000), NOW)

    // Same status, same length, different reason: the overlay needs the difference without a
    // second field, so it has to survive in cooldownReason.
    expect(wall.status).toBe(window.status)
    expect(wall.coolUntil).toBe(window.coolUntil)
    expect(wall.cooldownReason).toBe('rpm_ip')
    expect(window.cooldownReason).toBe('rpm_key')
  })

  it('changes the status but invents no length when the upstream sent no Retry-After', () => {
    const cooled = accountAfterVerdict(acct(), verdict('rpm_ip', null), NOW)

    expect(cooled.status).toBe('rate_limited')
    expect(cooled.cooldownReason).toBe('rpm_ip')
    // Not NOW, not zero, not present: resume-now is the one reading section 9.2 rules out.
    expect(cooled.coolUntil).toBeUndefined()
  })

  it('does not cool the account because a model went missing', () => {
    const cooled = accountAfterVerdict(acct(), verdict('model_missing', null), NOW)

    expect(cooled.status).toBe('available')
    expect(cooled.cooldownReason).toBe('model_missing')
    expect(cooled.coolUntil).toBeUndefined()
  })

  it('keys an IP wall by provider alone, and a Key wall by alias', () => {
    const byIp = [cooldownKeyOf('amd', 'AMD-A', verdict('rpm_ip', 60_000)), cooldownKeyOf('amd', 'AMD-B', verdict('rpm_ip', 60_000))]
    const byKey = [cooldownKeyOf('amd', 'AMD-A', verdict('rpm_key', 60_000)), cooldownKeyOf('amd', 'AMD-B', verdict('rpm_key', 60_000))]

    expect(byIp).toEqual(['amd', 'amd'])
    expect(byKey).toEqual(['amd:AMD-A', 'amd:AMD-B'])
    expect(cooldownKeyOf('amd', 'AMD-A', verdict(null, null))).toBeNull()
  })
})

describe('A-19 four cooling reasons are distinguishable', () => {
  it('rpm_key → rate_limited with reason rpm_key', () => {
    const cooled = accountAfterVerdict(acct(), verdict('rpm_key', 30_000), NOW)
    expect(cooled.status).toBe('rate_limited')
    expect(cooled.cooldownReason).toBe('rpm_key')
    expect(cooled.coolUntil).toBe(NOW + 30_000)
  })

  it('rpm_ip → rate_limited with reason rpm_ip', () => {
    const cooled = accountAfterVerdict(acct(), verdict('rpm_ip', 60_000), NOW)
    expect(cooled.status).toBe('rate_limited')
    expect(cooled.cooldownReason).toBe('rpm_ip')
    expect(cooled.coolUntil).toBe(NOW + 60_000)
  })

  it('concurrency → rate_limited with reason concurrency', () => {
    const cooled = accountAfterVerdict(acct(), verdict('concurrency', 5_000), NOW)
    expect(cooled.status).toBe('rate_limited')
    expect(cooled.cooldownReason).toBe('concurrency')
    expect(cooled.coolUntil).toBe(NOW + 5_000)
  })

  it('daily_quota → quota_exhausted with reason daily_quota', () => {
    const cooled = accountAfterVerdict(acct(), verdict('daily_quota', 34_200_000), NOW)
    expect(cooled.status).toBe('quota_exhausted')
    expect(cooled.cooldownReason).toBe('daily_quota')
    expect(cooled.coolUntil).toBe(NOW + 34_200_000)
  })

  it('all four reasons are pairwise distinct', () => {
    const reasons = ['rpm_key', 'rpm_ip', 'concurrency', 'daily_quota'].map((rc) =>
      accountAfterVerdict(acct(), verdict(rc, 10_000), NOW).cooldownReason
    )
    expect(new Set(reasons).size).toBe(4)
  })
})
