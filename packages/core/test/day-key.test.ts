import { describe, expect, it } from 'vitest'
import { beijingDayKey, beijingResetEpochMs, dayKeyOf } from '../src/day-key.js'

/**
 * 北京时间自然日（docs/02 §1.2 每日用量上限: 00:00 UTC+8 重置; docs/04 §1 Gate 1 dailyQuota）
 *
 * beijingDayKey(epochMs) -> 'YYYY-MM-DD'
 *   必须纯 UTC+8 偏移计算，不依赖宿主 TZ（DST、locale）。Asia/Shanghai 无 DST，
 *   但实现仍读取「偏移」而非「本地日历」。
 *
 * 边界夹具来自 docs/07-ACCEPTANCE.md A-13:
 *   2026-08-25T15:59:59Z  === 2026-08-25 23:59:59+08 -> '2026-08-25'
 *   2026-08-25T16:00:00Z  === 2026-08-26 00:00:00+08 -> '2026-08-26'  (重置)
 *   2026-08-25T17:30:00Z  === 2026-08-26 01:30+08    -> '2026-08-26'
 */
describe('beijingDayKey (A-13 boundary, 02 §1.2)', () => {
  const at = (iso: string) => Date.parse(iso)

  it('23:59:59+08 is still the previous day', () => {
    expect(beijingDayKey(at('2026-08-25T15:59:59Z'))).toBe('2026-08-25')
  })

  it('00:00:00+08 flips to the next day (reset instant)', () => {
    expect(beijingDayKey(at('2026-08-25T16:00:00Z'))).toBe('2026-08-26')
  })

  it('01:30+08 stays on the same day', () => {
    expect(beijingDayKey(at('2026-08-25T17:30:00Z'))).toBe('2026-08-26')
  })

  it('16:00Z-1 = 16:00Z exactly one day apart differ by one', () => {
    expect(beijingDayKey(at('2026-08-26T15:59:59Z'))).toBe('2026-08-26')
    expect(beijingDayKey(at('2026-08-26T16:00:00Z'))).toBe('2026-08-27')
  })

  it('independent of the host TZ (always UTC+8 wall clock)', () => {
    const saved = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      expect(beijingDayKey(at('2026-08-25T16:00:00Z'))).toBe('2026-08-26')
      process.env.TZ = 'UTC'
      expect(beijingDayKey(at('2026-08-25T16:00:00Z'))).toBe('2026-08-26')
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })

  it('returns null for invalid input', () => {
    expect(beijingDayKey(Number.NaN)).toBeNull()
    expect(beijingDayKey(-1)).toBeNull()
    expect(beijingDayKey(8.64e15 + 1)).toBeNull()
  })
})

describe('dayKeyOf(epochMs, offsetMinutes)', () => {
  it('offset 0 == UTC day', () => {
    expect(dayKeyOf(0, 0)).toBe('1970-01-01')
  })
  it('offset 480 == Beijing', () => {
    expect(dayKeyOf(Date.parse('2026-08-25T16:00:00Z'), 480)).toBe('2026-08-26')
  })
})

describe('beijingResetEpochMs(dayKey)', () => {
  it('returns the UTC instant of 00:00+08 for that key', () => {
    expect(beijingResetEpochMs('2026-08-26')).toBe(Date.parse('2026-08-26T00:00:00+08:00'))
    expect(new Date(beijingResetEpochMs('2026-08-26')!).toISOString()).toBe('2026-08-25T16:00:00.000Z')
  })
  it('null for junk', () => {
    expect(beijingResetEpochMs('2026-13-01')).toBeNull()
    expect(beijingResetEpochMs('')).toBeNull()
  })
})
