import { describe, expect, it } from 'vitest'
import { parseTokenCount } from '../src/token-count.js'

/**
 * U-02 parseTokenCount (docs/02-CONSTRAINTS.md §4.5, docs/03-DATA-CONTRACT.md §3.3)
 *
 * 铁律 5: never invent a number. '65.5K' could be 67072 (×1024) or
 * 65536/65500 (×1000-ish); because both readings "说了得通" we do NOT guess:
 *   value: null, raw: '65.5K', ambiguous: true
 * '1M' likewise -> value: null, ambiguous: true (the only real 1M figure we have,
 * SenseNova context_length 1048576, arrives as a NUMBER -- numbers are accepted
 * verbatim, no unit parsing).
 *
 * Contract:
 *  - number input         -> { value: n, raw: String(n), ambiguous: false }
 *  - numeric string       -> same
 *  - '512K' / '1M' / ...   -> { value: null, raw, ambiguous: true }
 *  - '65536 tokens'       -> { value: 65536, raw, ambiguous: false }  (explicit token unit)
 *  - missing / junk       -> null  (caller maps to Sourced{value:null, source:'unknown'})
 */
describe('U-02 parseTokenCount', () => {
  it('accepts a plain number as authoritative (no guesswork)', () => {
    expect(parseTokenCount(1048576)).toEqual({ value: 1048576, raw: '1048576', ambiguous: false })
  })

  it('accepts a numeric string', () => {
    expect(parseTokenCount('262144')).toEqual({ value: 262144, raw: '262144', ambiguous: false })
  })

  it('never guesses 1M: keeps ra w, value null, ambiguous', () => {
    expect(parseTokenCount('1M')).toEqual({ value: null, raw: '1M', ambiguous: true })
  })

  it('never guesses 512K', () => {
    expect(parseTokenCount('512K')).toEqual({ value: null, raw: '512K', ambiguous: true })
  })

  it('never guesses 65.5K (would be 65500 vs 67072)', () => {
    expect(parseTokenCount('65.5K')).toEqual({ value: null, raw: '65.5K', ambiguous: true })
  })

  it('accepts an explicit token unit', () => {
    expect(parseTokenCount('65536 tokens')).toEqual({ value: 65536, raw: '65536 tokens', ambiguous: false })
    expect(parseTokenCount('65,536 tokens')).toEqual({ value: 65536, raw: '65,536 tokens', ambiguous: false })
  })

  it('returns null for missing or junk input', () => {
    expect(parseTokenCount(undefined)).toBeNull()
    expect(parseTokenCount(null)).toBeNull()
    expect(parseTokenCount('')).toBeNull()
    expect(parseTokenCount('unknown')).toBeNull()
    expect(parseTokenCount('tokens')).toBeNull()
    expect(parseTokenCount(Number.NaN)).toBeNull()
    expect(parseTokenCount(-1)).toBeNull()
  })
})
