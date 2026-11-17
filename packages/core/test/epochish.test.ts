import { describe, expect, it } from 'vitest'
import { parseEpochish } from '../src/epochish.js'

/**
 * U-?? / B-03 (docs/07-ACCEPTANCE.md B-03, docs/02-CONSTRAINTS.md §2.2 / §1.3)
 *
 * NIM / OpenAI style X-RateLimit-Reset may arrive as:
 *   - epoch seconds   ('1730000123')
 *   - epoch millis    ('1730000123000')
 *   - relative secs   ('12')
 * "不得把毫秒当秒算出「等 5 万年」".
 *
 * Returns the absolute epoch in MILLISECONDS, or null when unparsable.
 * Heuristic lives in docs/06-TASKS.md T-0-b: >1e12 ms, >1e9 s, else relative.
 */
describe('parseEpochish (B-03 reset-header normalisation)', () => {
  const now = 1730000100000 // 2024-10-27T06:15:00Z, a fixed injected clock

  it('treats > 1e12 as epoch milliseconds', () => {
      expect(parseEpochish('1730000123000', now)).toBe(1_730_000_123_000)
  })

  it('treats > 1e9 as epoch seconds and scales to ms', () => {
    expect(parseEpochish('1730000123', now)).toBe(1_730_000_123_000)
  })

  it('treats small values as relative seconds from now', () => {
    expect(parseEpochish('12', now)).toBe(now + 12_000)
    expect(parseEpochish(1.5, now)).toBe(now + 1_500)
  })

  it('never yields a "50 thousand years" wait for a millisecond header', () => {
    expect(parseEpochish('1730000123000', now)).toBeLessThan(now + 365 * 24 * 3600 * 1000)
  })

  it('returns null for missing / junk / non-finite', () => {
    expect(parseEpochish(undefined, now)).toBeNull()
    expect(parseEpochish(null, now)).toBeNull()
    expect(parseEpochish('', now)).toBeNull()
    expect(parseEpochish('0', now)).toBeNull()
    expect(parseEpochish('-3', now)).toBeNull()
    expect(parseEpochish('abc', now)).toBeNull()
    expect(parseEpochish(Number.NaN, now)).toBeNull()
    expect(parseEpochish(Number.POSITIVE_INFINITY, now)).toBeNull()
  })

  it('accepts a numeric-typed header value', () => {
    expect(parseEpochish(1730000123, now)).toBe(1_730_000_123_000)
  })
})
