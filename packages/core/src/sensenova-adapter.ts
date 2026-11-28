/**
 * SenseNova adapter (docs/06 T-4-a, T-4-b, T-4-c, T-4-d; catalog/limits.json sensenova).
 *
 * 三份一手资料全文 0 命中 RPM/TPM/QPS/Retry-After：不得引入任何未经确认的数值。
 * admitRpm=3(assume) 是初始保守值，运行后按 429 率 AIMD 调整；admitRpmHardCap=30(assume) 是升速封顶。
 * 无用量端点：usageEndpoint=null，fetchUsage 返回 undefined。
 * 配额池：窗口5h=120000 pts，窗口周=1200000 pts（doc-local，来自 SenseNova-API-文档整理.md）。
 */

import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass, UsageResult } from './contract.js'
import { parseRetryAfter } from './retry-after.js'

export const SENSENOVA_ADMIT_RPM = 3
export const SENSENOVA_ADMIT_RPM_HARD_CAP = 30
export const SENSENOVA_BACKOFF_START_MS = 30_000
export const SENSENOVA_BACKOFF_MAX_MS = 300_000
export const SENSENOVA_BACKOFF_DECELERATE = 0.5
export const SENSENOVA_SLOWDOWN_COOLDOWN_MS = 300_000
export const SENSENOVA_MIGRATE_AFTER_CONSECUTIVE_429 = 3

/** SenseNova error body shape: OpenAI-compatible { error: { message, type, code } }. */
function parseSensenovaError(body: string): { message: string | null; code: string | null; type: string | null } {
  try {
    const json = JSON.parse(body)
    if (json && typeof json === 'object' && 'error' in json && json.error !== null && typeof json.error === 'object') {
      const err = json.error as Record<string, unknown>
      return {
        message: typeof err.message === 'string' ? err.message : null,
        code: typeof err.code === 'string' ? err.code : null,
        type: typeof err.type === 'string' ? err.type : null,
      }
    }
  } catch {
    // not JSON
  }
  return { message: null, code: null, type: null }
}

/** Classify a SenseNova response into a RateClass (or null when not rate-limited). */
export function classifySensenova(res: AdapterResponse): RateClass | null {
  if (res.status === 429) return 'rate_opaque' // 三份资料均未给出 429 的细分码
  if (res.status === 401 || res.status === 403) return 'auth'
  if (res.status === 400) {
    const parsed = parseSensenovaError(res.body)
    if (parsed.message !== null && /model/i.test(parsed.message)) return 'model_missing'
  }
  return null
}

/** Transport outcome for one SenseNova response. */
export function classifySensenovaTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown' {
  if (res.status >= 200 && res.status < 300) return 'ok'
  if (res.status >= 500) return 'upstream_5xx'
  if (res.status === 429) return 'unknown'
  if (res.status >= 400) return 'client_4xx'
  return 'unknown'
}

/** Backoff policy for SenseNova (catalog values). */
export function sensenovaBackoff(rc: RateClass, attempt: number): Backoff {
  let waitMs = SENSENOVA_BACKOFF_START_MS * Math.pow(2, attempt - 1)
  if (waitMs > SENSENOVA_BACKOFF_MAX_MS) waitMs = SENSENOVA_BACKOFF_MAX_MS
  const jitterMs = Math.floor(waitMs * 0.15)
  return { waitMs, jitterMs }
}

/** Read rate-limit headers from a SenseNova response. No such headers documented → null. */
export function sensenovaReadHeaders(res: AdapterResponse): HeaderSnapshot | null {
  return null
}

/** SenseNova has no usage endpoint → fetchUsage returns undefined. */
export const SENSENOVA_FETCH_USAGE: undefined = undefined

/** SenseNova model catalog result (empty until a real catalog endpoint is wired). */
export function sensenovaEmptyCatalog(): { ok: true; models: []; fetchedAt: string } {
  return { ok: true, models: [], fetchedAt: new Date().toISOString() }
}
