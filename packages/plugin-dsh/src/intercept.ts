/**
 * Intercept layer for the AMD dashboard panel.
 *
 * Every chat request DSH sends at AMD goes through `ctx.llm.stream`. Step 1 wraps that stream
 * so an AMD request is admitted by the gate and recorded as a `MetricsEvent` -- nothing more.
 * The gate is consulted but its wait is 0: nothing refuses, nothing delays, nothing changes a
 * routing decision. Step 2 (reject-before-429, cool, rotate) is opt-in later and will ask first.
 *
 * What this file does NOT do:
 * - It does NOT refuse or delay any request (gate wait is 0).
 * - It does NOT rotate keys on 429.
 * - It does NOT switch accounts on migration kinds.
 * - It does NOT own credentials injection, key-status watching, or channel/serveOn. apply()
 *   does those; this layer only reads the shared `facts` object and hooks into llm.stream.
 */

import {
  DEFAULT_AMD_POLICY,
  USAGE_POLL_FLOOR_MS,
  AccountGate,
  computeBudget,
  createSystemClock,
  createMetricsStore,
  type AdmissionPolicy,
  type MetricsStore,
  type MetricsEvent,
  type ProviderId,
  READING_MINUTES,
  READING_ROWS,
  rowsOf,
  trendOf,
  concurrencyOf,
  heatOf,
  type MinuteConcurrency,
  type MinuteHeat,
} from '@dsh-multipool/core'
import type { SourceHooks } from './source.js'
import type { SourceFacts } from './source.js'
import type { UsageAttempt } from './usage.js'
import { readAmdUsage, withProviderUsage, diagnoseAmd } from './usage.js'
import { AMD_KEY_REF_NAME } from './channel.js'
import type { KeyStatus } from './credentials.js'
import type { UsageResult } from '@dsh-multipool/core'
import type { CredentialSeam, KeyState } from './key-store.js'

export interface InterceptOptions {
  readonly facts?: Parameters<typeof import('./source.js').channelSourceFrom>[0]
  readonly nowMs?: () => number
  readonly baseUrl?: string
  /**
   * Step 2 gate: when true, a `tryAcquire` that returns `ok: false` causes the request
   * to be rejected outright (429-like response, no upstream call). Defaults to false --
   * step 1 is read-only: the gate is consulted and its budget observed, but nothing is
   * refused, nothing is delayed, nothing changes a routing decision.
   */
  readonly rejectOnBudgetExhausted?: boolean
}

export interface InterceptHandle {
  readonly disposer: () => void
  readonly gate: AccountGate
  readonly store: MetricsStore
  readonly hooks: SourceHooks
}

export interface InterceptContext {
  readonly effect: (callback: () => () => void) => () => void
  readonly inject?: (names: string[], callback: (child: { credentials?: CredentialSeam }) => void) => () => void
  readonly llm: {
    stream: (options: { provider: string; model: string; messages: unknown[]; signal?: AbortSignal }) => AsyncIterable<unknown>
  }
}

export interface InterceptStreamOptions {
  readonly provider: string
  readonly model: string
  readonly messages: unknown[]
  readonly signal?: AbortSignal
  readonly baseUrl?: string
  readonly body?: unknown
  readonly headers?: Record<string, string>
}

export function createIntercept(
  ctx: InterceptContext,
  options: InterceptOptions = {},
): InterceptHandle {
  const nowMs = options.nowMs ?? (() => createSystemClock().now())

  // 1) Admission gate - same policy the rail prints
  const gate = new AccountGate(createSystemClock(), DEFAULT_AMD_POLICY)

  // 2) Metrics store - 30 day window, rollups forever
  const store = createMetricsStore(createSystemClock())

  // 3) Seam wiring - only to obtain the key for forwarding and for usage reads.
  //    apply() owns credentials injection, key-status watching, and writes offer.
  let seam: CredentialSeam | undefined

  const keyDisposer = injectSeam(ctx, (s) => {
    seam = s
  })

  // 4) Facts object shared with apply() (not copied) so both read/write the same object
  const facts = (options.facts ?? {}) as {
    accounts: import('@dsh-multipool/core').Account[] | undefined
    events: MetricsEvent[] | undefined
    usage: Readonly<Partial<Record<ProviderId, UsageResult | null>>> | undefined
    activeSessions: number | undefined
    queued: number | undefined
    keyLayer: string | undefined
    reading?: 'unread' | 'read' | 'empty'
    /** Step 2 gate toggle: the settings section flips this; absent means off. */
    rejectOnBudgetExhausted?: boolean
  }

  // 5) lastAttemptMs shared with apply()'s usage hook so polls inside the minute are carried,
  //    not refused.
  let lastAttemptMs: number | undefined

  // 6) Hooks that the channel uses - now they do real work
  const hooks: SourceHooks = {
    readFromSeam: () => readSeamNow(seam, facts, undefined),
    testUsage: (providerId: ProviderId) =>
      askUsage(providerId, seam, nowMs, () => lastAttemptMs, stamp => { lastAttemptMs = stamp }, facts, () => readSeamNow(seam, facts, undefined)),
    readUsage: (providerId: ProviderId) =>
      askUsage(providerId, seam, nowMs, () => lastAttemptMs, stamp => { lastAttemptMs = stamp }, facts, () => readSeamNow(seam, facts, undefined)),
    readDashboard: () => {
      const events = facts.events ?? []
      const now = nowMs()
      return {
        trend: trendOf(events, now, READING_MINUTES),
        rows: rowsOf(events, READING_ROWS),
        concurrency: concurrencyOf(events, now, READING_MINUTES),
        heat: heatOf(events, now, READING_MINUTES),
      }
    },
    diagnose: (providerId: ProviderId) =>
      diagnoseAmd({
        providerId,
        seam,
        reference: AMD_KEY_REF_NAME,
        nowMs: nowMs(),
        lastAttemptMs,
      }),
  }

  // 7) Key-status watcher is owned by apply(); this layer only tears down the seam watcher
  const drops: Array<() => void> = [keyDisposer]

  // 8) LLM waterfall intercept - THIS IS THE KEY PART
  const originalStream = ctx.llm.stream
  ctx.llm.stream = async function* (options: InterceptStreamOptions) {
    // Only intercept AMD provider requests
    if (options.provider === 'amd') {
      // Gate admission (record the budget but don't wait yet - step 1 is read-only)
      const reservation = gate.tryAcquire('chat')

      // Step 2: reject before 429 when the opt-in switch is on.
      // Default off: tryAcquire logs budget but does not block, nothing changes a routing decision.
      // Read from shared facts each time so the settings section can flip it live.
      if (!reservation.ok && (facts.rejectOnBudgetExhausted ?? false)) {
        const waitMs = reservation.waitMs ?? 0
        const errorBody = JSON.stringify({
          error: {
            message: 'AMD account RPM budget exhausted for this minute',
            type: 'rate_limit',
            retry_after_ms: waitMs,
          },
        })
        const rejectRes = new Response(errorBody, {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'content-type': 'application/json',
            'retry-after': String(Math.ceil(waitMs / 1000)),
          },
        })
        for await (const chunk of [rejectRes]) {
          yield chunk
        }
        return
      }

      // Build the forward URL and headers using the seam's key
      const keyFrame = await getKeyFromSeam(seam)
      const forwardedHeaders = await buildForwardHeaders(options, keyFrame)
      const targetUrl = `${(options.baseUrl ?? 'https://developer.amd.com.cn/radeon/api/v1').replace(/\/$/, '')}/v1/chat/completions`

      const startMs = nowMs()
      let responseStatus = 0
      let responseHeaders: Record<string, string> = {}
      let responseBody = ''
      let rateKind: import('@dsh-multipool/core').RateKind | null = null
      let queueWaitMs = 0
      let latencyMs = 0

      try {
        // Forward the request
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: forwardedHeaders,
          body: JSON.stringify(options.body ?? options),
          signal: options.signal,
        })
        responseStatus = res.status
        responseHeaders = Object.fromEntries(res.headers.entries())
        responseBody = await res.text()

        // Classify the response
        const { parseAmdError, classifyAmdRateClass, retryAfterMsOf } = await import('@dsh-multipool/core')
        const parsedError = parseAmdError(responseBody)
        rateKind = classifyAmdRateClass(
          { status: responseStatus, headers: responseHeaders, body: responseBody },
          parsedError,
          retryAfterMsOf({ status: responseStatus, headers: responseHeaders, body: responseBody }, nowMs())
        )

        // Observe gate with response headers (account-level remaining RPM)
        const headerRemaining = parseHeaderRemaining(responseHeaders)
        if (headerRemaining !== null) gate.observeHeaders(headerRemaining)
      } catch {
        // Network/transport error
        responseStatus = 0
      } finally {
        latencyMs = nowMs() - startMs
      }

      // Record metrics event
      const event: MetricsEvent = {
        ts: startMs,
        providerId: 'amd',
        accountAlias: keyFrame?.accountAlias ?? 'unknown',
        keyIdMasked: keyFrame?.keyIdMasked ?? '',
        modelId: options.model ?? 'unknown',
        requestId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        status: responseStatus,
        latencyMs,
        attempt: 1,
        promptTokens: countPromptTokens(options.messages as { role?: string; content?: string | { type?: string; text?: string }[] }[]),
        completionTokens: 0,
        rateKind: rateKind ?? undefined,
        queueWaitMs,
        concurrencyAtSend: 1,
      }
      store.append(event)
      store.prune(nowMs())

      // Yield the original stream (we don't transform chunks in step 1)
      for await (const chunk of originalStream(options)) {
        yield chunk
      }
      return
    }

    // Non-AMD: pass through unchanged
    for await (const chunk of originalStream(options)) {
      yield chunk
    }
  }

  return {
    disposer: () => {
      // Restore original stream
      ctx.llm.stream = originalStream
      for (const drop of drops.reverse()) drop()
    },
    gate,
    store,
    hooks,
  }
}

// Helper: inject seam from credentials service
function injectSeam(
  ctx: InterceptContext,
  onSeam: (seam: CredentialSeam | undefined) => void,
): () => void {
  const inject = ctx.inject
  if (typeof inject !== 'function') {
    onSeam(undefined)
    return () => undefined
  }
  try {
    return inject.call(ctx, ['credentials'], (child) => {
      onSeam(child.credentials)
    })
  } catch {
    onSeam(undefined)
    return () => undefined
  }
}

// Helper: read seam now
async function readSeamNow(
  seam: CredentialSeam | undefined,
  facts: SourceFacts,
  onRead?: (status: KeyStatus) => void,
): Promise<boolean> {
  if (seam === undefined) return false
  const { readKeyStatus, AMD_KEY_REF } = await import('./credentials.js')
  const status = await readKeyStatus({ credentials: seam }, AMD_KEY_REF)
  if (status.kind !== 'read') return false
  const accounts = accountFromStatus(status.state)
  if (accounts === undefined) return false
  facts.accounts = accounts
  facts.keyLayer = status.state.kind === 'configured' ? status.state.layer : undefined
  if (status.state.kind !== 'configured') return false
  if (onRead !== undefined) onRead(status)
  return true
}

// Helper: convert KeyState to Account[]
function accountFromStatus(state: KeyState): import('@dsh-multipool/core').Account[] | undefined {
  if (state.kind !== 'configured') return undefined
  return [{
    providerId: 'amd',
    accountAlias: 'AMD_API_KEY',
    keyIdMasked: 'AMD_API_KEY',
    enabled: true,
    limits: { rpmAccount: { value: 20, source: 'assume', ref: 'docs/02' }, dailyQuota: undefined, planTier: undefined },
    status: 'available',
    coolUntil: undefined,
    cooldownReason: undefined,
    lastSeenAt: undefined,
  }]
}

// Helper: ask usage
async function askUsage(
  providerId: ProviderId,
  seam: CredentialSeam | undefined,
  nowMs: () => number,
  lastAttemptMs: () => number | undefined,
  stamp: (atMs: number) => void,
  facts: SourceFacts,
  readFromSeam: () => Promise<boolean>,
): Promise<UsageAttempt> {
  const stale = lastAttemptMs()
  const insideFloor = stale !== undefined && nowMs() - stale < USAGE_POLL_FLOOR_MS
  let layer = facts?.keyLayer
  if (!insideFloor && seam !== undefined) {
    await readFromSeam()
    layer = facts?.keyLayer
  }
  const attempt = await readAmdUsage({
    providerId,
    seam,
    reference: 'AMD_API_KEY',
    nowMs: nowMs(),
    ...(lastAttemptMs() === undefined ? {} : { lastAttemptMs: lastAttemptMs() as number }),
    ...(facts?.usage?.[providerId] === undefined ? {} : { previous: facts?.usage?.[providerId] as UsageResult }),
    ...(layer === undefined ? {} : { layer }),
  })
  if (!attempt.tooSoon) stamp(attempt.atMs)
  if (facts !== undefined && attempt.usage !== null) {
    facts.usage = withProviderUsage(facts.usage, providerId, attempt.usage)
  }
  return attempt
}

// Helper: get key from seam for forwarding
async function getKeyFromSeam(seam: CredentialSeam | undefined): Promise<{ accountAlias: string; keyIdMasked: string; secret: string } | null> {
  if (seam === undefined) return null
  const stored = await seam.resolve('AMD_API_KEY')
  if (stored === undefined) return null
  const masked = stored.value.slice(0, 4) + '...' + stored.value.slice(-4)
  return { accountAlias: 'AMD_API_KEY', keyIdMasked: masked, secret: stored.value }
}

// Helper: build forward headers
async function buildForwardHeaders(
  options: { headers?: Record<string, string> },
  keyFrame: { secret: string } | null,
): Promise<Record<string, string>> {
  const { stripClientAuth } = await import('@dsh-multipool/core')
  const forwarded = stripClientAuth(options.headers ?? {})
  if (keyFrame) {
    forwarded.authorization = `Bearer ${keyFrame.secret}`
  }
  return forwarded
}

// Helper: parse header remaining
function parseHeaderRemaining(headers: Record<string, string>): number | null {
  const remaining = headers['x-ratelimit-remaining-user-rpm'] ?? headers['x-ratelimit-remaining']
  if (remaining === undefined) return null
  const n = parseInt(remaining, 10)
  return Number.isFinite(n) ? n : null
}

// Helper: count prompt tokens (rough estimate)
function countPromptTokens(messages: { role?: string; content?: string | { type?: string; text?: string }[] }[]): number {
  if (!messages || !messages.length) return 0
  let total = 0
  for (const m of messages) {
    if (m.content) {
      if (typeof m.content === 'string') total += m.content.length / 4
      else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text' && block.text) total += block.text.length / 4
        }
      }
    }
  }
  return Math.round(total)
}