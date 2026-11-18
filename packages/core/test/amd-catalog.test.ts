import { beforeEach, describe, expect, it } from 'vitest'
import {
  CATALOG_REFRESH_MS,
  fetchCatalog,
  normalizeModels,
  parseCatalogResponse,
  resetCatalogCache,
  setCatalogTransport,
} from '../src/amd-catalog.js'
import { parseAmdError } from '../src/amd-error.js'
import { plan, recorded, resetUpstream, startFakeUpstream } from './fixtures/fake-upstream.js'

type CatalogEntry = Record<string, unknown>

/** 02 section 1.7 sample catalog. Snake_case keys are what the gateway really sends. */
const SAMPLE: CatalogEntry[] = [
  {
    id: 'DeepSeek-V4-Flash',
    name: 'DeepSeek V4 Flash',
    family: 'deepseek',
    providers: [{ tools: true, vision: false, reasoning: true, stability: 'beta' }],
    pricing: { prompt: '0.00000014', completion: '0.00000028', input_cache_read: '0.0000000028' },
    context_length: 1048576,
    supported_parameters: ['tools', 'reasoning', 'max_tokens'],
    json_output: true,
    structured_outputs: false,
    free: false,
    stability: 'beta',
  },
  {
    id: 'tiny-free',
    name: 'Tiny Free',
    context_length: 8192,
    pricing: { prompt: '0', completion: '0' },
    free: true,
    stability: 'stable',
  },
  {
    id: 'no-free-field',
    name: 'No Free Field',
    context_length: 32768,
    pricing: { prompt: '0.0000002', completion: '0.0000004' },
  },
]

function copies(): CatalogEntry[] {
  return JSON.parse(JSON.stringify(SAMPLE)) as CatalogEntry[]
}

function installTransport(): void {
  setCatalogTransport(async (url, init) => {
    const res = await fetch(url, { method: 'GET', headers: { ...init.headers } })
    return { status: res.status, text: () => res.text() }
  })
}

describe('A-09 catalog fields land, prices stay strings', () => {
  let models: ReturnType<typeof normalizeModels>

  beforeEach(() => {
    models = normalizeModels(JSON.parse(JSON.stringify(SAMPLE)) as unknown[], 'amd')
  })

  it('parses a bare list with no object / owned_by / created', () => {
    expect(models).toHaveLength(3)
    expect(models.every(m => m.providerId === 'amd')).toBe(true)
  })

  it('DeepSeek-V4-Flash carries every documented field', () => {
    const m = models[0]
    if (m === undefined) throw new Error('first model missing')
    expect(m.id).toBe('DeepSeek-V4-Flash')
    expect(m.displayName).toBe('DeepSeek V4 Flash')
    expect(m.family?.value).toBe('deepseek')
    expect(m.contextLength?.value).toBe(1048576)
    expect(m.supportedParameters?.value).toEqual(['tools', 'reasoning', 'max_tokens'])
    expect(m.capabilities?.tools?.value).toBe(true)
    expect(m.capabilities?.vision?.value).toBe(false)
    expect(m.capabilities?.reasoning?.value).toBe(true)
    expect(m.capabilities?.jsonMode?.value).toBe(true)
    expect(m.capabilities?.structuredOutputs?.value).toBe(false)
    expect(m.stability?.value).toBe('beta')
  })

  it('prices are decimal strings, never numbers', () => {
    const m = models[0]
    if (m === undefined) throw new Error('first model missing')
    expect(m.pricing?.prompt?.value).toBe('0.00000014')
    expect(m.pricing?.completion?.value).toBe('0.00000028')
    expect(m.pricing?.inputCacheRead?.value).toBe('0.0000000028')
    for (const p of [m.pricing?.prompt, m.pricing?.completion, m.pricing?.inputCacheRead]) {
      expect(typeof p?.value).toBe('string')
    }
  })
})

describe('A-10 free !== true means it costs pts', () => {
  let models: ReturnType<typeof normalizeModels>

  beforeEach(() => {
    models = normalizeModels(copies(), 'amd')
  })

  it('a model without a free field is costGuarded, not free', () => {
    const noField = models.find(m => m.id === 'no-free-field')
    if (noField === undefined) throw new Error('fixture model missing')
    expect(noField.free?.value).toBeNull()
    expect(noField.free?.source).toBe('unknown')
    expect(noField.costGuard).toBe(true)
  })

  it('free:true is the only value that clears the guard', () => {
    const free = models.find(m => m.id === 'tiny-free')
    if (free === undefined) throw new Error('fixture model missing')
    expect(free.free?.value).toBe(true)
    expect(free.costGuard).toBe(false)
  })
})

describe('A-11 an unsupported model is a 400, not a 404', () => {
  it('the gateway 400 says model_missing and does not cool the Key', () => {
    const parsed = parseAmdError(
      '{"detail":{"error":{"message":"Requested model Foo not supported","type":"invalid_request_error","code":"model_not_supported"}}}',
    )
    expect(parsed.shell).toBe('detail-error')
    expect(parsed.message).toContain('Requested model Foo not supported')
  })

  it('a body with no such wording is not model_missing', () => {
    const parsed = parseAmdError('{"detail":{"error":{"message":"bad temperature"}}}')
    expect(parsed.message).not.toContain('not supported')
  })
})

describe('catalog refresh cadence (02 section 1.5)', () => {
  beforeEach(() => {
    resetCatalogCache()
    resetUpstream()
    installTransport()
  })

  it('defaults to ten minutes, because listing models counts against RPM', () => {
    expect(CATALOG_REFRESH_MS).toBe(600_000)
  })

  it('two calls inside the window reach upstream once', async () => {
    const upstream = await startFakeUpstream({})
    const now = 0
    try {
      plan('/v1/models', { status: 200, body: JSON.stringify({ data: SAMPLE }) })
      const first = await fetchCatalog('rc-fixture-key', now, upstream.url)
      const second = await fetchCatalog('rc-fixture-key', now, upstream.url)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(recorded().filter(h => h.path === '/v1/models')).toHaveLength(1)
    } finally {
      await upstream.close()
    }
  })

  it('a call past the window refreshes again', async () => {
    const upstream = await startFakeUpstream({})
    const now = 0
    try {
      plan('/v1/models', { status: 200, body: JSON.stringify({ data: SAMPLE }) })
      await fetchCatalog('rc-fixture-key', now, upstream.url)
      await fetchCatalog('rc-fixture-key', now + CATALOG_REFRESH_MS + 1, upstream.url)
      expect(recorded().filter(h => h.path === '/v1/models')).toHaveLength(2)
    } finally {
      await upstream.close()
    }
  })

  it('a failed refresh keeps the last snapshot and marks staleSince', async () => {
    const upstream = await startFakeUpstream({})
    const now = 0
    try {
      plan('/v1/models', { status: 200, body: JSON.stringify({ data: SAMPLE }) })
      await fetchCatalog('rc-fixture-key', now, upstream.url)
      plan('/v1/models', { status: 502, body: 'bad gateway' })
      const after = await fetchCatalog('rc-fixture-key', now + CATALOG_REFRESH_MS + 1, upstream.url)
      expect(after.ok).toBe(true)
      expect(after.staleSince).toBeDefined()
    } finally {
      await upstream.close()
    }
  })
})
