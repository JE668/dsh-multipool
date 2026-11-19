/**
 * The local proxy (docs/06 T-1-g): DSH points its baseUrl here, we point the request
 * at AMD with a key from the pool. Three rules decide everything below.
 *
 * 1. The client's Authorization never leaves this machine. It is stripped before
 *    forwarding, whatever it contains, even when it looks like a real key -- the
 *    client was told to fill in a placeholder and we do not trust that it did.
 * 2. A request we cannot place is answered 503 with a Retry-After, never 429. 429
 *    from here would be indistinguishable from AMD's own and would teach callers to
 *    count retries against a limit that does not exist.
 * 3. X-RateLimit-* from AMD travels back renamed to X-DSH-MP-*: the client must not
 *    mistake our admission numbers for the upstream's.
 */

import type { Clock } from './clock.js'
import type { RateKind, Sourced } from './contract.js'
import { headerOf, parseAmdError, retryAfterMsOf } from './amd-error.js'
import { AMD_RPM_ACCOUNT, AMD_RPM_KEY, AMD_WINDOW_MS } from './limits.js'
import { maskKey } from './secret.js'

/** Which AMD paths the proxy exposes, and how it forwards them. */
export const PROXY_ROUTES = [
  '/v1/chat/completions',
  '/v1/audio/speech',
  '/v1/systemone',
  '/v1/messages',
  '/v1/messages/count_tokens',
  '/v1/models',
] as const

export type ProxyRoute = (typeof PROXY_ROUTES)[number]

export const SATURATED_CODE = 'dsh_multipool_saturated'

/** Header AMD sends back that we rename so the two counters never get confused. */
export const RATE_HEADER_PREFIX = 'x-ratelimit-'
export const PROXY_HEADER_PREFIX = 'x-dsh-mp-'

export interface PooledKey {
  readonly accountAlias: string
  readonly keyId: string
  readonly secret: string
}

export interface ProxyResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface Saturated {
  readonly status: 503
  readonly retryAfterMs: number
}

/**
 * 04 section 5: a client may not charge its own rate limit against ours, so the header
 * comes back rewritten, and the same is true of every AMD quota header.
 */
export function renameRateHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower.startsWith(RATE_HEADER_PREFIX)) {
      out[PROXY_HEADER_PREFIX + lower.slice(RATE_HEADER_PREFIX.length)] = value
      continue
    }
    out[lower] = value
  }
  return out
}

/** The client's own credentials must not survive the hop, whatever field they sat in. */
export function stripClientAuth(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'proxy-authorization') continue
    out[lower] = value
  }
  return out
}

export function saturationBody(retryAfterMs: number): string {
  return JSON.stringify({ code: SATURATED_CODE, retryAfterMs })
}

/** `Retry-After` in whole seconds, rounded up, never 0: a 0 says "retry now". */
export function retryAfterSeconds(ms: number): string {
  return String(Math.max(1, Math.ceil(ms / 1_000)))
}

export function isProxyRoute(path: string): path is ProxyRoute {
  const bare = path.split('?')[0] ?? path
  return (PROXY_ROUTES as readonly string[]).includes(bare)
}
export interface Lease {
  readonly key: PooledKey
  release(): void
}

/**
 * Round-robin over whatever keys have room in the current window. It is the fallback
 * for a client that sends no session id; sessions that do send one are served by
 * scheduler.ts, which keeps them on the same key to protect the prefix cache.
 */
export class KeyPool {
  private readonly inFlight = new Map<string, number>()
  private readonly sentAt: number[] = []
  private cursor = 0

  constructor(
    private readonly clock: Clock,
    private readonly keys: readonly PooledKey[],
    private readonly admitRpm: number,
    private readonly concurrency: number,
  ) {}

  /** The key this request would get, or how long until one is free. */
  acquire(): Lease | { readonly retryAfterMs: number } {
    const nowMs = this.clock.now()
    this.evict(nowMs)
    if (this.keys.length === 0) return { retryAfterMs: 60_000 }
    if (this.sentAt.length >= this.admitRpm) {
      const head = this.sentAt[0] ?? nowMs
      return { retryAfterMs: Math.max(1_000, head + AMD_WINDOW_MS - nowMs) }
    }
    const key = this.keys[this.cursor % this.keys.length]
    this.cursor += 1
    if (key === undefined) return { retryAfterMs: 60_000 }
    if ((this.inFlight.get(key.keyId) ?? 0) >= this.concurrency) {
      return { retryAfterMs: 1_000 }
    }
    this.sentAt.push(nowMs)
    this.inFlight.set(key.keyId, (this.inFlight.get(key.keyId) ?? 0) + 1)
    return {
      key,
      release: () => {
        const left = (this.inFlight.get(key.keyId) ?? 1) - 1
        if (left <= 0) this.inFlight.delete(key.keyId)
        else this.inFlight.set(key.keyId, left)
      },
    }
  }

  private evict(nowMs: number): void {
    const floor = nowMs - AMD_WINDOW_MS
    while (this.sentAt.length > 0) {
      const head = this.sentAt[0]
      if (head === undefined || head >= floor) break
      this.sentAt.shift()
    }
  }
}

export type Forward = (
  url: string,
  init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: string | null },
) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly text: () => Promise<string> }>

export interface ProxyRequest {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | null
}

export interface ProxyDeps {
  readonly pool: KeyPool
  readonly forward: Forward
  /** Upstream origin, e.g. https://developer.amd.com.cn/radeon . */
  readonly baseUrl: string
}

/**
 * One request in, one response out. The ordering matters and is the ticket:
 * admission happens BEFORE the key is picked, which happens BEFORE anything is
 * forwarded -- so a saturated proxy answers 503 having touched no upstream at all.
 */
export async function handleProxyRequest(deps: ProxyDeps, request: ProxyRequest): Promise<ProxyResponse> {
  const admitted = deps.pool.acquire()
  if ('retryAfterMs' in admitted) {
    return {
      status: 503,
      headers: {
        'retry-after': retryAfterSeconds(admitted.retryAfterMs),
        'content-type': 'application/json',
      },
      body: saturationBody(admitted.retryAfterMs),
    }
  }

  const lease = admitted
  try {
    const forwarded: Record<string, string> = {
      ...stripClientAuth(request.headers),
      authorization: `Bearer ${lease.key.secret}`,
    }
    const target = `${deps.baseUrl.replace(/\/$/, '')}${request.path}`
    const res = await deps.forward(target, {
      method: request.method,
      headers: forwarded,
      body: request.body,
    })
    return {
      status: res.status,
      headers: renameRateHeaders(res.headers),
      body: await res.text(),
    }
  } finally {
    lease.release()
  }
}
