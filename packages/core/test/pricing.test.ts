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
