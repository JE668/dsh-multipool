import { describe, expect, it } from 'vitest'
import { parseRetryAfter } from '../src/retry-after.js'

/**
 * U-01 parseRetryAfter
 * docs/07-ACCEPTANCE.md U-01: '60' -> 60s; HTTP date -> correct delta; '0' -> 0;
 * undefined -> null; '60s' / 'abc' -> null and never throws.
 * docs/04-SCHEDULER.md §5.2: Retry-After may be seconds or an HTTP date.
 *
 * Contract: parseRetryAfter returns milliseconds, or null when the header is
 * absent / unparseable. Never clamps, never rounds to a provider-suggested
 * interval -- callers must decide 铁律 4 (upstream value wins).
 */
describe('U-01 parseRetryAfter', () => {
  // Fixed "now" so HTTP-date parsing is deterministic; epoch = 2026-10-21T07:28:00Z
  const now = Date.UTC(2026, 9, 21, 7, 28, 0)

  it('parses delta-seconds as string', () => {
    expect(parseRetryAfter('60', now)).toBe(60_000)
  })

  it('parses delta-seconds as number', () => {
    expect(parseRetryAfter(60, now)).toBe(60_000)
  })

  it('parses "0" as zero (not null, not "missing")', () => {
    expect(parseRetryAfter('0', now)).toBe(0)
  })

  it('parses delta-seconds with surrounding whitespace', () => {
    expect(parseRetryAfter('  120  ', now)).toBe(120_000)
  })

  it('parses an HTTP-date by subtracting from now', () => {
    // 60 seconds after `now`
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:29:00 GMT', now)).toBe(60_000)
  })

  it('parses an HTTP-date in the past as 0, never negative', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', now)).toBe(0)
  })

  it('returns null for undefined / null / empty', () => {
    expect(parseRetryAfter(undefined, now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
    expect(parseRetryAfter('', now)).toBeNull()
    expect(parseRetryAfter('   ', now)).toBeNull()
  })

  it('returns null (and does not throw) for unit-suffixed junk such as "60s"', () => {
    expect(() => parseRetryAfter('60s', now)).not.toThrow()
    expect(parseRetryAfter('60s', now)).toBeNull()
  })

  it('returns null (and does not throw) for "abc"', () => {
    expect(() => parseRetryAfter('abc', now)).not.toThrow()
    expect(parseRetryAfter('abc', now)).toBeNull()
  })

  it('returns null for negative and non-finite numbers', () => {
    expect(parseRetryAfter('-5', now)).toBeNull()
    expect(parseRetryAfter(Number.NaN, now)).toBeNull()
    expect(parseRetryAfter(Number.POSITIVE_INFINITY, now)).toBeNull()
  })

  it('rejects booleans/objects instead of coercing them', () => {
    expect(parseRetryAfter(true as never, now)).toBeNull()
    expect(parseRetryAfter({} as never, now)).toBeNull()
  })
})
