import { describe, expect, it } from 'vitest'
import {
  AMD_BOUNDS,
  PROVIDER_BASE_URLS,
  baseUrlIsReadOnly,
  validateAmdKey,
  validateConcurrency,
  validateRpm,
} from '../src/amd-settings.js'

describe('C-01 budget self-check refuses a value above the published bound', () => {
  it('refuses concurrency 9 and lets 6 through', () => {
    const nine = validateConcurrency(9)
    expect(nine.ok).toBe(false)
    if (nine.ok) throw new Error('unreachable')
    expect(nine.rejection.rule).toBe('C-01')
    expect(nine.rejection.field).toBe('concurrency')
    expect(nine.rejection.bound?.value).toBe(8)
    expect(nine.rejection.message).toContain('8')
    expect(nine.rejection.citation?.doc).toContain('02-CONSTRAINTS')

    const six = validateConcurrency(6)
    expect(six).toEqual({ ok: true, value: 6 })
  })

  it('accepts the shipped bound itself and refuses rpm above 20', () => {
    expect(validateConcurrency(8).ok).toBe(true)
    const over = validateRpm(21)
    expect(over.ok).toBe(false)
    if (over.ok) throw new Error('unreachable')
    expect(over.rejection.bound?.value).toBe(20)
    expect(over.rejection.message).toContain('20')
    expect(validateRpm(20).ok).toBe(true)
    expect(validateRpm(11).ok).toBe(true)
  })

  it('refuses a non-integer or non-positive input the same way', () => {
    for (const bad of [0, -1, 8.5, Number.NaN]) {
      expect(validateConcurrency(bad).ok).toBe(false)
    }
  })

  it('names the documents it trusts on a rejection', () => {
    expect(AMD_BOUNDS.concurrencyPerKey.citation.doc).toContain('02-CONSTRAINTS')
    expect(AMD_BOUNDS.rpmAccount.citation.doc).toContain('02-CONSTRAINTS')
    expect(AMD_BOUNDS.concurrencyPerKey.citation.retrievedOn).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  })
})

describe('C-02 rejected_key', () => {
  it('refuses an sk- key without saving it', () => {
    const out = validateAmdKey('sk-abc123def456')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.rejection.rule).toBe('C-02')
    expect(out.rejection.message).toContain('Token Factory')
    // The refusal explains the rc- shape; it must not echo what was typed.
    expect(JSON.stringify(out)).not.toContain('abc123def456')
  })

  it('refuses the GPU instance inference URL', () => {
    const out = validateAmdKey('https://jupyter.anruicloud.com/inference/inst-42/v1')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.rejection.rule).toBe('C-02')
    expect(out.rejection.message).toContain('1.9')
  })

  it('refuses an empty key and a bare prefix', () => {
    expect(validateAmdKey('   ').ok).toBe(false)
    expect(validateAmdKey('rc-').ok).toBe(false)
  })

  it('accepts an rc- key and trims what it accepted', () => {
    const out = validateAmdKey('  rc-0123456789abcdef  ')
    expect(out).toEqual({ ok: true, value: 'rc-0123456789abcdef' })
  })

  it('does not pass off another provider key as AMD', () => {
    for (const foreign of ['nvapi-abcdefgh1234', 'AIzaSyABCDEFGH1234', 'cpk-abcdefgh1234']) {
       expect(validateAmdKey(foreign).ok).toBe(false)
    }
  })
})

describe('C-03 base URL is read-only', () => {
  it('accepts the published address and refuses any other', () => {
    const published = PROVIDER_BASE_URLS.amd
    expect(published).toBe('https://developer.amd.com.cn/radeon/api/v1')
    expect(baseUrlIsReadOnly('amd', undefined)).toEqual({ ok: true, value: published })
    expect(baseUrlIsReadOnly('amd', published).ok).toBe(true)
    const other = baseUrlIsReadOnly('amd', 'https://jupyter.anruicloud.com/inference/inst-42/v1')
    expect(other.ok).toBe(false)
    if (other.ok) throw new Error('unreachable')
    expect(other.rejection.rule).toBe('C-03')
  })

  it('publishes an address for every provider of the batch that has one', () => {
    expect(Object.keys(PROVIDER_BASE_URLS).sort()).toEqual(['agnes', 'amd', 'google', 'nim', 'sensenova'])
  })
})
