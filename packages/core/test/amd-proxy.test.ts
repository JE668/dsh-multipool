import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import {
  KeyPool,
  SATURATED_CODE,
  handleProxyRequest,
  renameRateHeaders,
  saturationBody,
  stripClientAuth,
  type Forward,
  type PooledKey,
  type ProxyDeps,
} from '../src/proxy.js'

const KEYS: readonly PooledKey[] = [
  { accountAlias: 'acct-a', keyId: 'rc-a', secret: 'rc-secret-a' },
  { accountAlias: 'acct-b', keyId: 'rc-b', secret: 'rc-secret-b' },
]

/** Records every call it gets, exactly as AMD's server would see it. */
function recordingForward(): { forward: Forward; calls: { url: string; headers: Readonly<Record<string, string>> }[] } {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = []
  return {
    calls,
    forward: async (url, init) => {
      calls.push({ url, headers: init.headers })
      return { status: 200, headers: { 'x-ratelimit-remaining-user-rpm': '12' }, text: async () => '{"ok":true}' }
    },
  }
}

describe('A-16 the proxy injects a pooled key and drops the client one', () => {
  it('never forwards the Authorization the client sent', async () => {
    const { forward, calls } = recordingForward()
    const deps: ProxyDeps = {
      pool: new KeyPool(createFakeClock({ now: 0 }), KEYS, 20, 8),
      forward,
      baseUrl: 'https://developer.amd.com.cn/radeon',
    }

    const res = await handleProxyRequest(deps, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { authorization: 'Bearer the-client-junk-value', 'content-type': 'application/json' },
      body: '{"model":"DeepSeek-V4-Flash","messages":[]}',
    })

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://developer.amd.com.cn/radeon/v1/chat/completions')
    expect(calls[0]?.headers['authorization']).toBe('Bearer rc-secret-a')
    expect(calls[0]?.headers['authorization']).not.toContain('junk')
  })

  it('strips x-api-key too', () => {
    expect(stripClientAuth({ 'X-Api-Key': 'nope', 'x-api-key': 'nope2', 'x-other': 'keep' })).toEqual({ 'x-other': 'keep' })
  })

  it('renames AMD quota headers instead of passing them through', () => {
    expect(renameRateHeaders({ 'X-RateLimit-Remaining-User-RPM': '12', 'x-ratelimit-reset': '1700000000', etag: 'x' }))
      .toEqual({ 'x-dsh-mp-remaining-user-rpm': '12', 'x-dsh-mp-reset': '1700000000', etag: 'x' })
  })
})

describe('A-17 saturation answers 503, never 429, and touches no upstream', () => {
  it('returns 503 with a Retry-After and the saturated code, upstream saw zero requests', async () => {
    const clock = createFakeClock({ now: 0 })
    const { forward, calls } = recordingForward()
    // one minute budget of one key, already spent
    const pool = new KeyPool(clock, [KEYS[0] as PooledKey], 1, 8)
    const deps: ProxyDeps = { pool, forward, baseUrl: 'https://developer.amd.com.cn/radeon' }

    const first = await handleProxyRequest(deps, { method: 'POST', path: '/v1/chat/completions', headers: {}, body: '{}' })
    expect(first.status).toBe(200)
    expect(calls).toHaveLength(1)

    const saturated = await handleProxyRequest(deps, { method: 'POST', path: '/v1/chat/completions', headers: {}, body: '{}' })
    expect(saturated.status).toBe(503)
    expect(saturated.status).not.toBe(429)
    expect(saturated.headers['retry-after']).toBeDefined()
    expect(Number(saturated.headers['retry-after'])).toBeGreaterThan(0)
    expect(JSON.parse(saturated.body)).toMatchObject({ code: SATURATED_CODE })

    // the whole point: the second request must not have reached the peer
    expect(calls).toHaveLength(1)
  })

  it('the 503 body carries the wait so a client can honour it', () => {
    expect(JSON.parse(saturationBody(59_500))).toEqual({ code: SATURATED_CODE, retryAfterMs: 59_500 })
  })
})
