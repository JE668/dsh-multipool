/**
 * AMD error-envelope parsing (docs/02 sections 1.4 and 1.8; docs/07 Z-07).
 *
 * Four shells can carry the same upstream refusal:
 *   - platform admission:  { detail: { error: { message, type, code } } }
 *   - gateway metering:     { error: { message, type, code } }        (top level, OpenAI shape)
 *   - Anthropic route:      { type: 'error', error: { type: 'rate_limit_error', message } }
 *   - plain detail:         { detail: "Login required" }
 *
 * Official warning (02 section 1.4) is why a code never decides anything on its own:
 *   "Do not judge from code alone. Handle by the 429 status, obey Retry-After."
 * This module only READS a code; docs/04 section 5.1 decides what to do with the status.
 *
 * Two bodies are not JSON at all and still reach here: an HTML error page and an
 * empty body. Neither may throw; both report their shell so the caller can log
 * what actually arrived instead of guessing.
 */

import type {
  AdapterResponse,
  ErrorShell,
  ParsedError,
  RateClass,
  RateKind,
  TransportKind,
} from './contract.js'
import { parseRetryAfter } from './retry-after.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

interface Fields {
  readonly message: string | null
  readonly code: string | null
  readonly type: string | null
}

function readOpenAIError(obj: Record<string, unknown>): Fields {
  return { message: str(obj['message']), code: str(obj['code']), type: str(obj['type']) }
}

function unreadable(shell: ErrorShell, json: Record<string, unknown> | null): ParsedError {
  return { shell, message: null, code: null, type: null, json, untrusted: true }
}

/**
 * Parse an AMD error body. Never throws; never invents a message.
 *
 * Precedence follows the official advice (02 section 1.8): read body.error if it is
 * there; otherwise read body.detail.error; otherwise treat body.detail as the error.
 * The Anthropic shell is tested first because it also has an `error` key but nests the
 * payload one level deeper and identifies itself with type: 'error'.
 */
export function parseAmdError(body: string | null | undefined): ParsedError {
  if (typeof body !== 'string') return unreadable('empty', null)
  const text = body.trim()
  if (text.length === 0) return unreadable('empty', null)

  // Upstream error pages arrive as HTML (nginx / gateway), not JSON.
  if (text.startsWith('<')) return unreadable('html', null)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return unreadable('unparsable', null)
  }
  if (!isRecord(parsed)) return unreadable('unparsable', null)

  const inner = parsed['error']
  if (parsed['type'] === 'error' && isRecord(inner)) {
    const fields = readOpenAIError(inner)
    return {
      shell: 'anthropic',
      message: fields.message,
      code: fields.code,
      type: fields.type,
      json: parsed,
      untrusted: fields.message === null,
    }
  }

  if (isRecord(inner)) {
    const fields = readOpenAIError(inner)
    return {
      shell: 'top-level',
      message: fields.message,
      code: fields.code,
      type: fields.type,
      json: parsed,
      untrusted: fields.message === null,
    }
  }

  const detail = parsed['detail']
  // 02 section 1.10 probe: {"detail":"Login required"} -- the string IS the message.
  if (typeof detail === 'string' && detail.trim().length > 0) {
    return { shell: 'detail', message: detail, code: null, type: null, json: parsed, untrusted: false }
  }
  if (isRecord(detail)) {
    const nested = detail['error']
    if (isRecord(nested)) {
      const fields = readOpenAIError(nested)
      return {
        shell: 'detail-error',
        message: fields.message,
        code: fields.code,
        type: fields.type,
        json: parsed,
        untrusted: fields.message === null,
      }
    }
    const plain = str(detail['message'])
    return { shell: 'detail', message: plain, code: str(detail['code']), type: null, json: parsed, untrusted: plain === null }
  }

  const topMessage = str(parsed['message'])
  if (topMessage !== null) {
    return { shell: 'top-level', message: topMessage, code: str(parsed['code']), type: str(parsed['type']), json: parsed, untrusted: false }
  }

  return unreadable('unparsable', parsed)
}

/** Bounds an upstream-supplied Retry-After so a garbage date cannot pin a Key for years. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

export function headerOf(res: AdapterResponse, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(res.headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

/**
 * Retry-After of a response in milliseconds, measured against the caller's clock.
 * nowMs is required on purpose: a missing clock number silently turns every HTTP-date
 * form into "already overdue" and the cooldown would read as 0 ms.
 */
export function retryAfterMsOf(res: AdapterResponse, nowMs: number): number | null {
  const raw = headerOf(res, 'retry-after')
  const parsed = parseRetryAfter(raw ?? null, nowMs)
  if (parsed === null) return null
  return parsed > MAX_RETRY_AFTER_MS ? MAX_RETRY_AFTER_MS : parsed
}

const MODEL_NOT_SUPPORTED_RE = /requested model .*not supported/i
const DAILY_QUOTA_RE = /daily usage limit exceeded/i

/**
 * 02 section 1.4 quotes Retry-After: 60 for the per-minute buckets.
 */
const RETRY_AFTER_FOR_MINUTE_BUCKETS_MS = 60_000
/** 02 section 1.4 quotes Retry-After: 1 for the concurrency buckets. */
const RETRY_AFTER_FOR_CONCURRENCY_MS = 1_000

export interface AmdDiagnostic {
  readonly status: number
  /** The first 2 KiB of the body, verbatim (07 Z-07): never summarized, never dropped. */
  readonly raw: string
  readonly shell: ErrorShell
}

export interface AmdVerdict {
  readonly rateClass: RateClass | null
  readonly transport: TransportKind
  /** As the platform asked. null means it asked for nothing, not "zero". */
  readonly retryAfterMs: number | null
  readonly diagnostic: AmdDiagnostic
}

function classifyAmd429(parsed: ParsedError, retryAfterMs: number | null): RateClass {
  // Anthropic route, own wording, no daily-quota branch (02 section 1.4).
  if (parsed.shell === 'anthropic') return 'rate_opaque'
  // Gateway metering layer, daily pts exhausted: 02 section 1.4 names this message verbatim.
  if (parsed.message !== null && DAILY_QUOTA_RE.test(parsed.message)) return 'daily_quota'
  // Platform admission layer (02 section 1.4): the same 429 carries two different codes and two
  // different Retry-After values -- 60 for the per-minute bucket, 1 for the concurrency bucket,
  // which is "released when the current request ends". Neither code decides which layer nor which
  // bucket: the layer is the shell, the bucket is the wait.
  if (parsed.shell === 'detail-error' || parsed.shell === 'detail') {
    // ip_rate_limit_exceeded also quotes 60, but it is not a Key window: the whole egress IP is
    // blocked, so every account behind it must stop, not just this Key (02 section 1.4).
    if (parsed.code === 'ip_rate_limit_exceeded') return 'rpm_ip'
    return retryAfterMs !== null && retryAfterMs <= RETRY_AFTER_FOR_CONCURRENCY_MS ? 'concurrency' : 'rpm_key'
  }
  // Gateway metering layer, per-minute quota: "maximum 20 requests per minute for this OneClick user".
  if (parsed.shell === 'top-level') return 'rpm_key'
  // HTML / empty / unreadable: the body does not say which limiter fired, and we will not invent one.
  return 'rate_opaque'
}

/**
 * Rate class for one AMD response, or null when the outcome is a transport one.
 *
 * Deliberately narrow: only the two shapes 02 section 1.8 documents for AMD are read. A
 * 404 is NOT translated to model_missing here -- AMD's documented miss is a 400
 * "Requested model <name> not supported", and inventing a second spelling would let a
 * real 404 (path typo) masquerade as "the model retired, refresh the catalog".
 */
export function classifyAmdRateClass(
  res: AdapterResponse,
  parsed: ParsedError,
  retryAfterMs: number | null,
): RateClass | null {
  if (res.status === 429) return classifyAmd429(parsed, retryAfterMs)
  if (res.status === 401 || res.status === 403) return 'auth'
  if (res.status === 400 && parsed.message !== null && MODEL_NOT_SUPPORTED_RE.test(parsed.message)) {
    return 'model_missing'
  }
  return null
}

/** Transport outcome for one AMD response (docs/03 section 4: never a MetricsEvent.rateKind). */
export function classifyAmdTransportKind(res: AdapterResponse): TransportKind {
  if (res.status >= 200 && res.status < 300) return 'ok'
  if (res.status >= 500) return 'upstream_5xx'
  if (res.status === 429) return 'unknown'
  if (res.status >= 400) return 'client_4xx'
  return 'unknown'
}

/**
 * Whole classification in one call: the rate class, the transport boundary, and the
 * diagnostics ring entry. `nowMs` comes from the caller's clock; nothing here reads a timer.
 */
export function classifyAmd(res: AdapterResponse, nowMs: number): AmdVerdict {
  const parsed = parseAmdError(res.body)
  const retryAfterMs = retryAfterMsOf(res, nowMs)
  return {
    rateClass: classifyAmdRateClass(res, parsed, retryAfterMs),
    transport: classifyAmdTransportKind(res),
    retryAfterMs,
    diagnostic: {
      status: res.status,
      raw: res.body.length > 2048 ? res.body.slice(0, 2048) : res.body,
      shell: parsed.shell,
    },
  }
}
