import { describe, expect, it } from 'vitest'
import {
  parseGoogleCatalogResponse,
  normalizeGoogleModel,
  normalizeGoogleModels,
  fetchGoogleCatalog,
  resetGoogleCatalogCache,
} from '../src/google-catalog.js'

describe('T-8-b: Google model catalog', () => {
  const NOW_ISO = new Date(0).toISOString()

  describe('normalizeGoogleModel', () => {
    it('strips models/ prefix from name', () => {
      const model = normalizeGoogleModel({ name: 'models/gemini-4-hydrogen' }, NOW_ISO)
      expect(model?.id).toBe('gemini-4-hydrogen')
      expect(model?.providerId).toBe('google')
    })

    it('leaves unprefixed name alone', () => {
      const model = normalizeGoogleModel({ name: 'gemini-4-hydrogen' }, NOW_ISO)
      expect(model?.id).toBe('gemini-4-hydrogen')
    })

    it('returns null for empty name', () => {
      expect(normalizeGoogleModel({ name: '' }, NOW_ISO)).toBeNull()
      expect(normalizeGoogleModel({}, NOW_ISO)).toBeNull()
    })

    it('extracts capabilities at top level', () => {
      const model = normalizeGoogleModel(
        { name: 'models/gemini-4-hydrogen', tools: true, vision: true, reasoning: false },
        NOW_ISO,
      )
      expect(model!.capabilities!.tools).toEqual({ value: true, source: 'api' })
      expect(model!.capabilities!.vision).toEqual({ value: true, source: 'api' })
      expect(model!.capabilities!.reasoning).toEqual({ value: false, source: 'api' })
    })

    it('extracts contextLength from contextLength field', () => {
      const model = normalizeGoogleModel(
        { name: 'models/gemini-4-hydrogen', contextLength: 262144 },
        NOW_ISO,
      )
      expect(model?.contextLength).toEqual({ value: 262144, source: 'api' })
    })

    it('costGuard is true (Google has no free field in catalog)', () => {
      const model = normalizeGoogleModel({ name: 'models/gemini-4-hydrogen' }, NOW_ISO)
      expect(model!.costGuard).toBe(true)
      expect(model!.free!.value).toBeNull()
    })
  })

  describe('parseGoogleCatalogResponse', () => {
    it('parses { models: [...] } shape', () => {
      const body = JSON.stringify({
        models: [{ name: 'models/gemini-4-hydrogen' }, { name: 'models/gemini-3.5-flash-lite' }],
      })
      const models = parseGoogleCatalogResponse(body)
      expect(models).toHaveLength(2)
      expect(models[0]!.id).toBe('gemini-4-hydrogen')
      expect(models[1]!.id).toBe('gemini-3.5-flash-lite')
    })

    it('returns [] for empty body', () => {
      expect(parseGoogleCatalogResponse('')).toEqual([])
    })

    it('returns [] for non-array models', () => {
      expect(parseGoogleCatalogResponse(JSON.stringify({ models: 'not an array' }))).toEqual([])
    })

    it('returns [] for unparsable body', () => {
      expect(parseGoogleCatalogResponse('not json')).toEqual([])
    })

    it('skips entries without name', () => {
      const body = JSON.stringify({
        models: [{ name: 'models/good' }, {}, { name: 'models/also-good' }],
      })
      const models = parseGoogleCatalogResponse(body)
      expect(models).toHaveLength(2)
    })
  })

  describe('normalizeGoogleModels', () => {
    it('normalizes a loose list', () => {
      const list = [
        { name: 'models/a' },
        { name: 'models/b' },
        { name: '' },
      ]
      const models = normalizeGoogleModels(list)
      expect(models).toHaveLength(2)
      expect(models[0]!.id).toBe('a')
      expect(models[1]!.id).toBe('b')
    })
  })

  describe('fetchGoogleCatalog', () => {
    it('returns error when no transport configured', async () => {
      const result = await fetchGoogleCatalog('test-key', 1_000_000_000_000)
      expect(result.ok).toBe(false)
      expect(result.error).toBe('no transport configured')
    })

    it('uses cache within refresh window', async () => {
      resetGoogleCatalogCache()
      let calls = 0
      const transport = async () => {
        calls++
        return { status: 200, text: () => Promise.resolve(JSON.stringify({ models: [] })) }
      }
      await fetchGoogleCatalog('key', 1_000, 'https://example.com', transport)
      await fetchGoogleCatalog('key', 1_500, 'https://example.com', transport) // within 600s
      expect(calls).toBe(1)
    })

    it('refetches after refresh window', async () => {
      resetGoogleCatalogCache()
      let calls = 0
      const transport = async () => {
        calls++
        return { status: 200, text: () => Promise.resolve(JSON.stringify({ models: [] })) }
      }
      await fetchGoogleCatalog('key', 1_000, 'https://example.com', transport)
      await fetchGoogleCatalog('key', 1_000_001, 'https://example.com', transport) // > 600s later
      expect(calls).toBe(2)
    })

    it('keeps stale result on failed refresh', async () => {
      resetGoogleCatalogCache()
      let callCount = 0
      const transport = async () => {
        callCount++
        if (callCount === 1) {
          return { status: 200, text: () => Promise.resolve(JSON.stringify({ models: [{ name: 'models/old' }] })) }
        }
        return { status: 500, text: () => Promise.resolve('') }
      }
      const first = await fetchGoogleCatalog('key', 1_000, 'https://example.com', transport)
      expect(first.ok).toBe(true)
      expect(first.models).toHaveLength(1)

      const second = await fetchGoogleCatalog('key', 1_000_001, 'https://example.com', transport)
      expect(second.ok).toBe(true)
      expect(second.models).toHaveLength(1) // stale kept
      expect(second.staleSince).toBeDefined()
    })
  })
})
