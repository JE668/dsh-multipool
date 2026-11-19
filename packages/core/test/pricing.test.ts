import { describe, expect, it } from 'vitest'
import { fallbacks, perMillion, pointsFor, type PriceInput } from '../src/pricing.js'
import { unknownValue } from '../src/contract.js'

/** docs/02 section 1.7 sample for DeepSeek-V4-Flash, pts per token. */
const DEEPSEEK: PriceInput = {
  prompt: { value: '0.00000014', source: 'api' },
  completion: { value: '0.00000028', source: 'api' },
  inputCacheRead: { value: '0.0000000028', source: 'api' },
}

describe('perMillion: the console unit, from the API unit', () => {
  it('turns 0.00000014 into 0.14 exactly, without float drift', () => {
    const price = perMillion(DEEPSEEK)
    expect(price.unit).toBe('per_million_tokens')
    expect(price.prompt.value).toBe('0.14')
    expect(price.completion.value).toBe('0.28')
    expect(price.inputCacheRead.value).toBe('0.0028')
  })

  it('leaves an absent price unknown rather than zero', () => {
    const price = perMillion({ prompt: DEEPSEEK.prompt })
    expect(price.completion.value).toBeNull()
    expect(price.completion.source).toBe('unknown')
    expect(price.inputCacheRead.value).toBeNull()
  })

  it('reports char billing as per_million_chars and offers no cache tier for it', () => {
    const price = perMillion({ perCharPrompt: { value: '0.000000035', source: 'doc-local' } })
    expect(price.unit).toBe('per_million_chars')
    expect(price.prompt.value).toBe('0.035')
    expect(price.inputCacheRead.value).toBeNull()
  })
})

describe('pointsFor: what a finished request cost', () => {
  it('charges cached input at the cache rate and the rest at the prompt rate', () => {
    // 1,000 prompt (200 cached) + 500 completion = 0.00000112 + 0.0000000056 + 0.00014
    expect(pointsFor(perMillion(DEEPSEEK), {
      promptTokens: 1000,
      completionTokens: 500,
      cacheReadTokens: 200,
    })).toBe('0.00025256')
  })

  it('bills reasoning outside completion at the completion rate', () => {
    const withReasoning = pointsFor(perMillion(DEEPSEEK), {
      promptTokens: 0,
      completionTokens: 100,
      reasoningTokens: 100,
    })
    const folded = pointsFor(perMillion(DEEPSEEK), { promptTokens: 0, completionTokens: 200 })
    expect(withReasoning).toBe(folded)
    expect(withReasoning).toBe('0.000056')
  })

  it('returns null rather than under-reporting when completion has no price', () => {
    expect(pointsFor(perMillion({ prompt: DEEPSEEK.prompt }), {
      promptTokens: 1000,
      completionTokens: 500,
    })).toBeNull()
  })

  it('never treats an absent cache rate as free', () => {
    const noCache = perMillion({ prompt: DEEPSEEK.prompt, completion: DEEPSEEK.completion })
    const withCacheUsage = pointsFor(noCache, { promptTokens: 100, completionTokens: 0, cacheReadTokens: 100 })
    const plain = pointsFor(noCache, { promptTokens: 100, completionTokens: 0, cacheReadTokens: 0 })
    expect(withCacheUsage).toBe(plain)
    expect(withCacheUsage).not.toBe('0')
  })
})

describe('perMillion: character-billed models', () => {
  const speech: PriceInput = {
    perCharPrompt: { value: '0.000000035', source: 'doc-local' },
    completion: unknownValue<string>('OmniVoice output is per output character, no tier published'),
  }

  it('keeps the per-character band and takes the prompt figure from it', () => {
    const priced = perMillion(speech)
    expect(priced.unit).toBe('per_million_chars')
    expect(priced.prompt.value).toBe('0.035')
    expect(priced.prompt.source).toBe('doc-local')
    expect(priced.inputCacheRead.value).toBeNull()
  })

  it('says why there is no cache tier rather than showing an absent one', () => {
    expect(perMillion(speech).inputCacheRead.source).toBe('unknown')
    expect(perMillion(speech).inputCacheRead.raw ?? '').toContain('cache')
  })

  it('does not mint a zero when the completion price is unknown', () => {
    expect(perMillion(speech).completion.value).toBeNull()
    expect(pointsFor(perMillion(speech), { promptTokens: 10, completionTokens: 10 })).toBeNull()
  })
})

describe('fallbacks: covering a blank API price with the console sheet', () => {
  const apiPrice: PriceInput = {
    prompt: { value: '0.00000014', source: 'api' },
    completion: { value: '0.00000028', source: 'api' },
  }
  const sheet: PriceInput = {
    prompt: { value: '0.0000002', source: 'doc-local' },
    completion: { value: '0.0000003', source: 'doc-local' },
    inputCacheRead: { value: '0.0000000028', source: 'doc-local', fetchedAt: '2026-10-19T00:00:00Z' },
  }

  it('leaves the API price in place and fills only the member the API left blank', () => {
    const covered = fallbacks(apiPrice, sheet, 'ref.md section 3.3')
    expect(covered.prompt).toEqual(apiPrice.prompt)
    expect(covered.completion).toEqual(apiPrice.completion)
    expect(covered.inputCacheRead).toEqual({
      value: '0.0000000028',
      source: 'doc-local',
      ref: 'ref.md section 3.3',
      fetchedAt: '2026-10-19T00:00:00Z',
    })
  })

  it('covers what an absent answer left in its place, and says where it came from', () => {
    const blank = unknownValue<string>('this model does not publish completion')
    const covered = fallbacks({ ...apiPrice, completion: blank }, sheet, 'ref.md section 3.3')
    expect(covered.completion).toEqual({
      value: '0.0000003',
      source: 'doc-local',
      ref: 'ref.md section 3.3',
      fetchedAt: undefined,
    })
  })

  it('passes the API price through untouched when there is no sheet', () => {
    expect(fallbacks(apiPrice, undefined, 'ref.md section 3.3')).toEqual(apiPrice)
  })
})

