/**
 * Test seams for every docs/07 case (07 §0).
 *
 * The rule these exist to enforce: a case asserts what the plugin SENT UPSTREAM --
 * the recorder's request stream -- and never what the plugin happens to log inside.
 * A passing assertion against an internal log proves only that we log what we
 * believe we do. The recorder proves the bytes left the process.
 *
 * Nothing here touches the network: it is an in-process Node http server on
 * 127.0.0.1:0, so the suite runs offline and in CI (07's [live] cases are the only
 * ones allowed out, and they live in scripts/smoke.ts).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { AMD_WINDOW_MS } from '../../src/limits.js'

/** One request that actually reached the fake upstream, timestamped on arrival. */
export interface Hit {
  /** Wall-clock ms (the same clock the test's FakeClock reports) when the request arrived. */
  readonly atMs: number
  readonly method: string
  /** Path plus query, exactly as received ("/v1/usage?include_recent=true"). */
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** A programmatic answer queued for a path. */
export interface PlannedResponse {
  readonly status: number
  readonly body?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Pause before answering so tests can observe in-flight concurrency. */
  readonly delayMs?: number
}

interface PlanEntry {
  /** Path this plan answers; "/v1/usage" also matches its query form. */
  readonly path: string
  /** Only answer on this hit number (1-based). Omitted = every hit. */
  readonly hits?: readonly number[]
  readonly response: PlannedResponse
}

/** Answers every hit the same way for the whole test (docs/07 §0: "the N-th request returns X"). */
const plans: PlanEntry[] = []
const hits: Hit[] = []
let windows = new Map<string, number[]>()

/**
 * Pre-decided behaviour for the N-th request to a path, replacing the upstream.
 *
 * `hits` is 1-based and optional: without it the plan answers every request to the
 * path; with it the plan answers only those requests, so a case can mix one 429 and
 * then normal traffic without a closure that has to count.
 */
export function plan(path: string, response: PlannedResponse, hits?: readonly number[]): void {
  plans.unshift({ path, response, ...(hits === undefined ? {} : { hits }) })
}

/** Every request the fake upstream saw, in arrival order. */
export function recorded(): readonly Hit[] {
  return hits
}

/** How many requests reached a path (exact match, or prefix when ending with "*"). */
export function countHits(path = '*'): number {
  return path === '*' ? hits.length : hits.filter(h => matches(h.path, path)).length
}

/** Forget everything an earlier case recorded and planned. Call from beforeEach. */
export function resetUpstream(): void {
  hits.length = 0
  plans.length = 0
  windows = new Map()
}

function matches(actual: string, wanted: string): boolean {
  if (wanted.endsWith('*')) return actual.startsWith(wanted.slice(0, -1))
  return actual === wanted || actual.startsWith(`${wanted}?`)
}

export function platform429(code: string, retryAfterSec: number, message = 'Model API rate limit exceeded; please retry later'): PlannedResponse {
  return {
    status: 429,
    headers: { 'retry-after': String(retryAfterSec), 'content-type': 'application/json' },
    body: JSON.stringify({ detail: { error: { message, type: 'rate_limit_error', code } } }),
  }
}

export function gateway429(message: string, retryAfterSec: number): PlannedResponse {
  return {
    status: 429,
    headers: { 'retry-after': String(retryAfterSec), 'content-type': 'application/json' },
    body: JSON.stringify({ error: { message, type: 'rate_limit_error', code: 'rate_limit_exceeded' } }),
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let text = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      text += chunk
    })
    req.on('end', () => resolve(text))
  })
}

function timeMs(): number {
  return Date.now()
}

export interface FakeUpstreamOptions {
  /** Enforce an upstream counter: the (rpm + 1)-th request inside one window gets a platform 429. */
  readonly rpm?: number
  /** Window length; defaults to AMD's documented 60 s. */
  readonly windowMs?: number
}

export interface FakeUpstream {
  readonly url: string
  close(): Promise<void>
}

export async function startFakeUpstream(options: FakeUpstreamOptions = {}): Promise<FakeUpstream> {
  const windowMs = options.windowMs ?? AMD_WINDOW_MS
  const rpm = options.rpm
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? '/'
    const nowMs = timeMs()
    readBody(req)
      .then(body => {
        hits.push({
          atMs: nowMs,
          method: req.method ?? 'GET',
          path,
          headers: { ...(req.headers as Record<string, string>) },
          body,
        })
        const planned = plans.find(p => matches(path, p.path) && (p.hits === undefined || p.hits.includes(countHits(p.path))))
        if (planned !== undefined) {
          const send = (): void => {
            res.statusCode = planned.response.status
            for (const [name, value] of Object.entries(planned.response.headers ?? {})) res.setHeader(name, value)
            res.end(planned.response.body ?? '')
          }
          if (planned.response.delayMs === undefined) send()
          else setTimeout(send, planned.response.delayMs)
          return
        }

        if (rpm !== undefined) {
          const key = req.headers.authorization ?? 'anonymous'
          const recent = (windows.get(key) ?? []).filter(at => at + windowMs > nowMs)
          if (recent.length >= rpm) {
            windows.set(key, recent)
            res.statusCode = 429
            res.setHeader('retry-after', '60')
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ detail: { error: { message: 'Model API rate limit exceeded; please retry later', type: 'rate_limit_error', code: 'token_rate_limit_exceeded' } } }))
            return
          }
          recent.push(nowMs)
          windows.set(key, recent)
        }

        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, path }))
      })
      .catch(() => {
        res.statusCode = 500
        res.end('')
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? (address as AddressInfo).port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
