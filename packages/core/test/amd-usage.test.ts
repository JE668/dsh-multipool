import { beforeEach, describe, expect, it } from 'vitest'
import {
  USAGE_POLL_DEFAULT_MS,
  USAGE_POLL_FLOOR_MS,
  fetchAmdUsage,
  parseUsageResponse,
  setUsageTransport,
} from '../src/amd-usage.js'
import { plan, recorded, resetUpstream, startFakeUpstream } from './fixtures/fake-upstream.js'

/** 02 section 1.6 verbatim shape. The usd suffix is a lie: these numbers are pts. */
const USAGE_BODY = JSON.stringify({
  rpm_limit: 30,
  daily_cost_limit_usd: 10,
  daily_cost_used_usd: 1.8412,
  daily_cost_remaining_usd: 8.1588,
  daily_reset_timezone: 'Asia/Shanghai',
  daily_reset_at: '2026-08-26T00:00:00+08:00',
  today: { requests: 142, errors: 3, total_tokens: 88214, prompt_tokens: 31002, completion_tokens: 57212, cost: 1.8412 },
  last_30_days: { requests: 2840, total_tokens: 1904221, cost: 39.77 },
  all_time: { requests: 9120, total_tokens: 6210443, cost: 128.44 },
  by_model: [{ model: 'DeepSeek-V4-Flash', requests: 120, total_tokens: 74001, cost: 1.55 }],
  recent: [],
})

describe('A-12 usage fields map without inventing units', () => {
  it('rpm_limit is the Key limit, never the account limit', () => {
    const u = parseUsageResponse(USAGE_BODY, '2026-11-18T00:00:00.000Z')
    expect(u.available).toBe(true)
    expect(u.rpmLimit?.value).toBe(30)
    // the account figure has no place in this payload, so the type must not carry one
    expect(Object.keys(u).filter(k => /account/i.test(k))).toEqual([])
  })

  it('the -usd fields are pts and keep the name pts all the way through', () => {
    const u = parseUsageResponse(USAGE_BODY, '2026-11-18T00:00:00.000Z')
    expect(u.dailyLimitPts?.value).toBe(10)
    expect(u.dailyUsedPts?.value).toBe(1.8412)
    expect(u.dailyRemainingPts?.value).toBe(8.1588)
  })

  it('the reset instant is kept exactly as sent, in +08:00', () => {
    const u = parseUsageResponse(USAGE_BODY, '2026-11-18T00:00:00.000Z')
    expect(u.dailyResetAt?.value).toBe('2026-08-26T00:00:00+08:00')
  })
})

describe('A-13 a failed poll is unknown, never zero', () => {
  beforeEach(() => {
    resetUpstream()
    setUsageTransport(async url => {
      const res = await fetch(url)
      return { status: res.status, text: () => res.text() }
    })
  })

  it('502 leaves the previous numbers in place and marks the fetch unknown', async () => {
    const upstream = await startFakeUpstream({})
    try {
      plan('/v1/usage', { status: 200, body: USAGE_BODY })
      const good = await fetchAmdUsage('rc-fixture-key', 1_000, upstream.url)
      expect(good.available).toBe(true)
      expect(good.dailyRemainingPts?.value).toBe(8.1588)

      plan('/v1/usage', { status: 502, body: 'bad gateway' })
      const state = { fetchedAt: good.fetchedAt as string, result: good }
      const bad = await fetchAmdUsage('rc-fixture-key', 2_000, upstream.url, state)
      expect(bad.available).toBe(false)
      expect(bad.reason).toBe('failed')
      expect(bad.dailyRemainingPts?.value).toBe(8.1588)
      expect(bad.dailyRemainingPts?.fetchedAt).toBe(good.fetchedAt)
      expect(bad.dailyRemainingPts?.value).not.toBe(0)
    } finally {
      await upstream.close()
    }
  })

  it('a 502 with nothing to fall back on reports unknown rather than zero', async () => {
    const upstream = await startFakeUpstream({})
    try {
      plan('/v1/usage', { status: 502, body: 'bad gateway' })
      const bad = await fetchAmdUsage('rc-fixture-key', 5_000, upstream.url)
      expect(bad.available).toBe(false)
      expect(bad.dailyRemainingPts).toBeUndefined()
    } finally {
      await upstream.close()
    }
  })
})

describe('A-14 polling cadence leaves the RPM budget room to talk', () => {
  it('polls no faster than once a minute by default', () => {
    expect(USAGE_POLL_DEFAULT_MS).toBe(300_000)
    expect(USAGE_POLL_FLOOR_MS).toBe(60_000)
    expect(USAGE_POLL_DEFAULT_MS).toBeGreaterThanOrEqual(USAGE_POLL_FLOOR_MS)
  })
})
