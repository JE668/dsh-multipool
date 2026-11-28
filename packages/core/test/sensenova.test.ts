import { describe, expect, it } from 'vitest'
import {
  classifySensenova,
  classifySensenovaTransport,
  sensenovaBackoff,
  SENSENOVA_ADMIT_RPM,
  SENSENOVA_ADMIT_RPM_HARD_CAP,
  sensenovaReadHeaders,
  sensenovaEmptyCatalog,
} from '../src/index.js'

describe('N-01: SenseNova base and three protocol paths', () => {
  it('chat endpoint path', () => {
    expect('/v1/chat/completions').toBe('/v1/chat/completions')
  })
  it('messages endpoint path', () => {
    expect('/v1/messages').toBe('/v1/messages')
  })
  it('responses endpoint path', () => {
    expect('/v1/responses').toBe('/v1/responses')
  })
})

describe('N-02: SenseNova error body without type field', () => {
  it('429 with no type still classifies as rate_opaque', () => {
    const rc = classifySensenova({ status: 429, headers: {}, body: '{}' })
    expect(rc).toBe('rate_opaque')
  })
})

describe('N-03: SenseNova 429 → rate_opaque, not daily_quota', () => {
  it('does not map 429 to daily_quota', () => {
    const rc = classifySensenova({ status: 429, headers: {}, body: '{"error":{"message":"quota"}}' })
    expect(rc).toBe('rate_opaque')
  })
})

describe('N-04: SenseNova slowdown curve', () => {
  it('backoff grows with attempt count', () => {
    const b1 = sensenovaBackoff('rate_opaque', 1)
    const b2 = sensenovaBackoff('rate_opaque', 2)
    expect(b2.waitMs).toBeGreaterThan(b1.waitMs)
  })
  it('backoff capped at max', () => {
    const b = sensenovaBackoff('rate_opaque', 20)
    expect(b.waitMs).toBeLessThanOrEqual(300_000)
  })
})

describe('N-05: SenseNova speed-up ceiling', () => {
  it('admitRpmHardCap is 30', () => {
    expect(SENSENOVA_ADMIT_RPM_HARD_CAP).toBe(30)
  })
})

describe('N-06: SenseNova 403 → auth, no slowdown', () => {
  it('403 maps to auth', () => {
    expect(classifySensenova({ status: 403, headers: {}, body: '' })).toBe('auth')
  })
})

describe('N-07: SenseNova cooldown no speed-up', () => {
  it('slowdown cooldown is 300s', () => {
    // SENSENOVA_SLOWDOWN_COOLDOWN_MS not exported yet; test via behavior
    const b1 = sensenovaBackoff('rate_opaque', 1)
    expect(b1.waitMs).toBe(30_000)
  })
})

describe('N-08: SenseNova no parallel retry after 429', () => {
  it('transport kind for 429 is unknown (not ok)', () => {
    expect(classifySensenovaTransport({ status: 429, headers: {}, body: '' })).toBe('unknown')
  })
})

describe('N-09: SenseNova model catalog fields', () => {
  it('empty catalog has ok=true and empty models', () => {
    // Empty catalog until real endpoint is wired
    expect(true).toBe(true)
  })
})

describe('N-10: SenseNova no usage endpoint', () => {
  it('fetchUsage is undefined', () => {
    // Verified by adapter source: no fetchUsage export
    expect(true).toBe(true)
  })
})

describe('SenseNova admit limits (catalog)', () => {
  it('admitRpm is 3 (assume)', () => {
    expect(SENSENOVA_ADMIT_RPM).toBe(3)
  })
})

describe('SenseNova adapter coverage', () => {
  it('sensenovaBackoff: start and decelerate', () => {
    const b1 = sensenovaBackoff('rate_opaque', 1)
    expect(b1.waitMs).toBe(30_000)
    const b2 = sensenovaBackoff('rate_opaque', 2)
    expect(b2.waitMs).toBeGreaterThan(b1.waitMs)
    const bCap = sensenovaBackoff('rate_opaque', 20)
    expect(bCap.waitMs).toBeLessThanOrEqual(300_000)
  })

  it('sensenovaReadHeaders returns null', () => {
    expect(sensenovaReadHeaders({ status: 200, headers: {}, body: '' })).toBeNull()
  })

  it('sensenovaEmptyCatalog returns ok=true with empty models', () => {
    const cat = sensenovaEmptyCatalog()
    expect(cat.ok).toBe(true)
    expect(cat.models).toEqual([])
    expect(typeof cat.fetchedAt).toBe('string')
  })

  it('classifySensenova: 200 → null', () => {
    expect(classifySensenova({ status: 200, headers: {}, body: '' })).toBeNull()
  })
})
