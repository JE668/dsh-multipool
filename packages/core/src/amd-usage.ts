/**
 * AMD usage polling (docs/02 section 1.6; docs/07 A-12..A-14).
 *
 * The response names every quota field `*_usd`, and none of them is a dollar amount:
 * they are pts, the tally the pricing sheet in 02 section 1.7 uses. The types here
 * therefore end in `Pts` and the UI wording is "pts". A "$" must never be printed next
 * to one of these numbers, and that starts by not letting the field name say "usd".
 *
 * `rpm_limit` is 30 -- the per-API-Key platform ceiling. It is NOT the account's 20,
 * which only ever arrives in a response header. Keeping both numbers in one type is how
 * a per-key limit turns into luggage, so UsageResult has no account field at all.
 *
 * The docs never promise that /v1/usage is free of RPM cost themselves, so a poll is
 * treated as a request: the caller budgets it, the default cadence is 5 minutes, and the
 * next poll can never fire sooner than 60s.
 */

import type { UsageResult } from './contract.js'
import { unknownValue } from './contract.js'

/** 02 section 1.6: the unknown endpoints are on the same key, so a poll is charged like any call. */
export const USAGE_POLL_DEFAULT_MS = 300_000

/** 02 section 1.6: refresh on demand is allowed, but at most once per minute. */
export const USAGE_POLL_FLOOR_MS = 60_000

type FetchLike = (url: string, init: { readonly headers: Record<string, string> }) => Promise<{ readonly status: number; text(): Promise<string> }>

let transport: FetchLike | null = null

export function setUsageTransport(next: FetchLike | null): void {
  transport = next
}

/** What the poller remembers between ticks: the last full snapshot and when it was seen. */
export interface UsagePollState {
  readonly fetchedAt: string
  readonly result: UsageResult
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}


/** Parse a /v1/usage body. An unreadable body is unknown, not zero. */
export function parseUsageResponse(body: string, fetchedAt: string): UsageResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { available: false, reason: 'failed' }
  }
  const root = asRecord(parsed)
  if (root === null) return { available: false, reason: 'failed' }

  return {
    available: true,
    rpmLimit: num_src(root['rpm_limit'], fetchedAt),
    dailyLimitPts: num_src(root['daily_cost_limit_usd'], fetchedAt),
    dailyUsedPts: num_src(root['daily_cost_used_usd'], fetchedAt),
    dailyRemainingPts: num_src(root['daily_cost_remaining_usd'], fetchedAt),
    dailyResetAt: reset_src(root['daily_reset_at']),
    fetchedAt,
  }
}

function reset_src(value: unknown): UsageResult['dailyResetAt'] {
  const v = str(value)
  return v === null ? unknownValue<string>() : { value: v, source: 'api' }
}

function num_src(value: unknown, fetchedAt: string) {
  const v = num(value)
  return v === null ? unknownValue<number>() : { value: v, source: 'api' as const, fetchedAt }
}

/**
 * GET /v1/usage?include_recent=true.
 *
 * On failure the previous snapshot is returned unchanged except its own `reason`, so the
 * UI keeps showing "8.1588 pts, as of 14:32" next to a an unknown badge instead of
 * blanking the row or, worse, printing a 0 the account does not have. `fetchedAt` on a
 * stale number is the previous fetch time precisely so the UI can say how old it is.
 */
export async function fetchAmdUsage(
  key: string,
  nowMs: number,
  baseUrl = 'https://developer.amd.com.cn/radeon/api/v1',
  previous?: UsagePollState,
): Promise<UsageResult> {
  const stale = (): UsageResult =>
    previous === undefined
      ? { available: false, reason: 'failed' }
      : { ...previous.result, available: false, reason: 'failed' }

  if (transport === null) return stale()

  const url = `${baseUrl.replace(/\/$/, '')}/v1/usage?include_recent=true`
  try {
    const res = await transport(url, { headers: { authorization: `Bearer ${key}` } })
    if (res.status < 200 || res.status >= 300) return stale()
    const fetchedAt = new Date(nowMs).toISOString()
    return parseUsageResponse(await res.text(), fetchedAt)
  } catch {
    return stale()
  }
}
