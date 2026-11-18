import { describe, expect, it } from 'vitest'

import { classifyAmd, classifyAmdRateClass, parseAmdError } from '../src/amd-error.js'
import type { AdapterResponse } from '../src/contract.js'

const NOW = 1_700_000_000_000

const res = (status: number, body: string, headers: Record<string, string> = {}): AdapterResponse => ({
  status,
  headers,
  body,
})

describe('A-08 three error shells parse without throwing', () => {
  it('gateway shell: {"error":{...}} lifts message and code', () => {
    const parsed = parseAmdError(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: maximum 20 requests per minute for this OneClick user. Please try again later.',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      }),
    )
    expect(parsed.shell).toBe('top-level')
    expect(parsed.message).toContain('maximum 20 requests per minute')
    expect(parsed.code).toBe('rate_limit_exceeded')
    expect(parsed.untrusted).toBe(false)
  })

  it('platform shell: {"detail":{"error":{...}}} lifts message and code', () => {
    const parsed = parseAmdError(
      JSON.stringify({
        detail: { error: { message: 'Model API rate limit exceeded; please retry later', type: 'rate_limit_error', code: 'token_rate_limit_exceeded' } },
      }),
    )
    expect(parsed.shell).toBe('detail-error')
    expect(parsed.message).toBe('Model API rate limit exceeded; please retry later')
    expect(parsed.code).toBe('token_rate_limit_exceeded')
  })

  it('Anthropic shell: {"type":"error","error":{...}} lifts message and type', () => {
    const parsed = parseAmdError(
      JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }),
    )
    expect(parsed.shell).toBe('anthropic')
    expect(parsed.message).toBe('Number of requests has exceeded your rate limit')
    expect(parsed.type).toBe('rate_limit_error')
  })

  it('plain detail string: {"detail":"Login required"} -> detail', () => {
    expect(parseAmdError('{"detail":"Login required"}').shell).toBe('detail')
    expect(parseAmdError('{"detail":"Login required"}').message).toBe('Login required')
  })
})

describe('A-08 HTML page and empty body never throw, and never explode', () => {
  it('HTML page classifies as unreadable, not as a JSON parse crash', () => {
    const parsed = parseAmdError('<!DOCTYPE html><html><body>502 Bad Gateway</body></html>')
    expect(parsed.shell).toBe('html')
    expect(parsed.message).toBeNull()
    expect(parsed.untrusted).toBe(true)
  })

  it('empty body classifies as empty', () => {
    expect(parseAmdError('').shell).toBe('empty')
    expect(parseAmdError('').message).toBeNull()
  })

  it('non-object JSON stays unreadable but keeps the raw text', () => {
    expect(parseAmdError('"nope"').shell).toBe('unparsable')
    expect(parseAmdError('{"a":').shell).toBe('unparsable')
    expect(parseAmdError(null).shell).toBe('empty')
  })
})

const platformCodesfilm = [
  'token_rate_limit_exceeded',
  'ip_rate_limit_exceeded',
  'token_concurrency_rate_limit_exceeded',
  'model_concurrency_rate_limit_exceeded',
  'process_concurrency_rate_limit_exceeded',
  'global_concurrency_rate_limit_exceeded',
] as const

const verdicts = ['rpm_key', 'rpm_ip', 'concurrency', 'concurrency', 'concurrency', 'concurrency'] as const

describe('A-04 the six platform codes land on their classes by Retry-After, not by code', () => {
  it.each(platformCodesfilm.map((code, i) => [code, code, i] as const))('%s', (_name, code, index) => {
    const retryAfterSec = index < 2 ? 60 : 1
    const body = JSON.stringify({
      detail: { error: { message: 'Model API rate limit exceeded; please retry later', type: 'rate_limit_error', code } },
    })
    const verdict = classifyAmdRateClass(
      res(429, body, { 'retry-after': String(retryAfterSec) }),
      parseAmdError(body),
      retryAfterSec * 1000,
    )
    // code 只决定展示文案；真正分桶的是 Retry-After：60 = 每分钟类（Key/IP），1 = 并发类。
    expect(verdict).toBe(verdicts[index])
  })

  it('garbage codes produce the same verdicts', () => {
    const garbage = ['zzz', 'q', 'nope', 'x9', 'unheard-of', '???']
    const got = garbage.map((code, index0) => {
      // the IP bucket is identified by its own code (02 section 1.4); only *other* garbage
      // words have to fall back to the resource the quoted wait points at.
      const index = index0 === 1 ? 0 : index0
      const retryAfterSec = index < 2 ? 60 : 1
      const body = JSON.stringify({
        detail: { error: { message: 'Model API rate limit exceeded; please retry later', type: 'rate_limit_error', code } },
      })
      return classifyAmdRateClass(res(429, body, { 'retry-after': String(retryAfterSec) }), parseAmdError(body), retryAfterSec * 1000)
    })
    expect(got).toEqual(['rpm_key', 'rpm_key', 'concurrency', 'concurrency', 'concurrency', 'concurrency'])
  })
})

describe('A-05 gateway 20-RPM 429', () => {
  it('top-level rate_limit_exceeded with Retry-After 60 is rpm_key, not a Key kill', () => {
    const body = JSON.stringify({
      error: {
        message: 'Rate limit exceeded: maximum 20 requests per minute for this OneClick user. Please try again later.',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
      },
    })
    const out = classifyAmd(res(429, body, { 'Retry-After': '60' }), NOW)
    expect(out.rateClass).toBe('rpm_key')
    expect(out.transport).toBe('unknown')
    expect(out.diagnostic.shell).toBe('top-level')
    expect(out.retryAfterMs).toBe(60_000)
  })
})

describe('A-06 gateway daily pts exhausted', () => {
  const body = JSON.stringify({
    error: {
      message: 'Daily usage limit exceeded: maximum $10 per period for this OneClick user.',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
  })

  it('classifies as daily_quota and keeps the retry window it was given', () => {
    const out = classifyAmd(res(429, body, { 'Retry-After': '34200' }), NOW)
    expect(out.rateClass).toBe('daily_quota')
    expect(out.retryAfterMs).toBe(34_200_000)
  })

  it('the upstream "$10" stays a point of text, never a currency amount of ours', () => {
    // The $ is pts in the gateway's own wording. We surface as a rate class, not as money.
    const out = classifyAmd(res(429, body, { 'Retry-After': '34200' }), NOW)
    expect(out.rateClass).toBe('daily_quota')
    expect(out.diagnostic.raw).toContain('$10')
  })
})

describe('A-11 unsupported model is a 400, not a 404', () => {
  const body = JSON.stringify({ detail: { error: { message: 'Requested model Foo not supported', type: 'invalid_request_error', code: 'model_not_supported' } } })

  it('maps to model_missing', () => {
    expect(classifyAmd(res(400, body), NOW).rateClass).toBe('model_missing')
  })

  it('does not cool the Key: model_missing is not a rate class on the account', () => {
    // A-11 asserts the Key stays selectable after it; the classifier only has to report the
    // kind. Cooling is the scheduler's job (T-1-f) and it treats model_missing as non-cooling.
    const out = classifyAmd(res(400, body), NOW)
    expect(out.rateClass).toBe('model_missing')
    expect(out.transport).toBe('client_4xx')
  })

  it('a plain 404 is not rewritten into model_missing', () => {
    expect(classifyAmd(res(404, JSON.stringify({ detail: 'Not Found' })), NOW).rateClass).toBeNull()
  })
})

describe('A-18 / Z-07 unknown bodies keep status and 2 KiB and never claim ok', () => {
  it('HTML 502 classifies unknown, transport upstream_5xx, raw retained', () => {
    const html = '<html>' + 'x'.repeat(4096) + '</html>'
    const out = classifyAmd(res(502, html), NOW)
    expect(out.rateClass).toBeNull()
    expect(out.transport).toBe('upstream_5xx')
    expect(out.diagnostic.status).toBe(502)
    expect(out.diagnostic.shell).toBe('html')
    expect(out.diagnostic.raw.length).toBe(2048)
    expect(out.diagnostic.raw.startsWith('<html>')).toBe(true)
  })

  it('a 429 with an empty body is rate_opaque, never ok', () => {
    const out = classifyAmd(res(429, ''), NOW)
    expect(out.rateClass).toBe('rate_opaque')
    expect(out.transport).toBe('unknown')
  })

  it('503 "Model gateway is busy" is upstream_5xx with no rate class', () => {
    const out = classifyAmd(res(503, '{"detail":"Model gateway is busy"}'), NOW)
    expect(out.rateClass).toBeNull()
    expect(out.transport).toBe('upstream_5xx')
  })

  it('an unparseable Retry-After does not throw and leaves retryAfterMs null', () => {
    const body = JSON.stringify({ detail: { error: { message: 'Model API rate limit exceeded; please retry later', code: 'token_rate_limit_exceeded' } } })
    expect(() => classifyAmd(res(429, body, { 'retry-after': 'soon-ish' }), NOW)).not.toThrow()
    expect(classifyAmd(res(429, body, { 'retry-after': 'soon-ish' }), NOW).retryAfterMs).toBeNull()
  })
})
