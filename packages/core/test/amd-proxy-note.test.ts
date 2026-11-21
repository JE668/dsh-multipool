import { describe, expect, it } from 'vitest'
import { createFakeClock } from '../src/clock.js'
import {
  KeyPool,
  handleProxyRequest,
  type Forward,
  type PooledKey,
  type ProxyDeps,
} from '../src/proxy.js'
import type { RateClass } from '../src/contract.js'

const KEYS: readonly PooledKey[] = [
  { accountAlias: 'acct-a', keyId: 'rc-a', secret: 'rc-secret-a' },
  { accountAlias: 'acct-b', keyId: 'rc-b', secret: 'rc-secret-b' },
]

/**
 * A one-key pool whose forward answers with whatever the test hands it, and a note() that
 * records what the proxy said. The pool is not the thing under test here -- whether the proxy
 * tells it the truth is.
 */
function rig(status: number, body: string): {
  readonly deps: ProxyDeps
  readonly noted: [string, RateClass][]
  readonly forwarded: string[]
} {
  const noted: [string, RateClass][] = []
  const forwarded: string[] = []
  const forward: Forward = async (url) => {
    forwarded.push(url)
    return { status, headers: {}, text: async () => body }
  }
  return {
    noted,
    forwarded,
    deps: {
      pool: new KeyPool(createFakeClock({ now: 0 }), KEYS, 20, 8),
      forward,
      baseUrl: 'https://developer.amd.com.cn/radeon',
      note: (accountAlias, rateClass) => noted.push([accountAlias, rateClass]),
      nowMs: () => 0,
    },
  }
}

describe('A-07 the proxy tells the pool what the upstream said', () => {
  it('reports rpm_ip for the account whose key was leased when the body is an IP wall', async () => {
    const r = rig(429, JSON.stringify({ detail: { error: { code: 'ip_rate_limit_exceeded' } } }))

    const res = await handleProxyRequest(r.deps, { method: 'POST', path: '/v1/chat/completions', headers: {}, body: '{}' })

    expect(res.status).toBe(429)
    expect(r.noted).toEqual([['acct-a', 'rpm_ip']])
  })

  it('keeps the IP wall off the Key bucket', async () => {
    const r = rig(429, JSON.stringify({ detail: { error: { code: 'ip_rate_limit_exceeded' } } }))

    await handleProxyRequest(r.deps, { method: 'POST', path: '/v1/chat/completions', headers: {}, body: '{}' })

    // rpm_key is the other account's business (04 section 9 S-06'). Sharing one word would
    // cool three accounts behind one egress IP, which is the guess 04fd646 removed.
    expect(r.noted.map(([, rateClass]) => rateClass)).not.toContain('rpm_key')
  })

  it('says nothing when the response carries no rate class', async () => {
    const r = rig(200, '{"ok":true}')

    const res = await handleProxyRequest(r.deps, { method: 'POST', path: '/v1/chat/completions', headers: {}, body: '{}' })

    expect(res.status).toBe(200)
    expect(r.noted).toEqual([])
  })

  it('still classifies and forwards when the caller passed no note sink', async () => {
    const forwarded: string[] = []
    const forward: Forward = async (url) => {
      forwarded.push(url)
      return { status: 204, headers: {}, text: async () => '' }
    }
    const deps: ProxyDeps = {
      pool: new KeyPool(createFakeClock({ now: 0 }), KEYS, 20, 8),
      forward,
      baseUrl: 'https://developer.amd.com.cn/radeon',
    }

    const res = await handleProxyRequest(deps, { method: 'GET', path: '/v1/models', headers: {}, body: null })

    expect(res.status).toBe(204)
    expect(forwarded).toHaveLength(1)
  })
})
