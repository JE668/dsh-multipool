/**
 * NVIDIA NIM adapter (docs/06 T-5-a; catalog/limits.json nim).
 *
 * rpm=40(user)，concurrency=6(assume)，admitRpm=34(assume = 40×0.85)。
 * 用量端点：无（usageEndpoint=null，"no-endpoint"）。
 * 模型目录：公开端点，无鉴权也返回 200，但不得用作配额探针。
 * 跨 Key 迁移：429 时不迁移（crossKeyMigrationOn429=false）。
 */

import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass, UsageResult } from './contract.js'

export const NIM_RPM = 40
export const NIM_CONCURRENCY = 6
export const NIM_ADMIT_RPM = 34

function parseNimError(body: string): { message: string | null; code: string | null } {
  try {
    const json = JSON.parse(body)
    if (json && typeof json === 'object' && 'error' in json && json.error !== null && typeof json.error === 'object') {
      const err = json.error as Record<string, unknown>
      return {
        message: typeof err.message === 'string' ? err.message : null,
        code: typeof err.code === 'string' ? err.code : null,
      }
    }
  } catch {
    // not JSON
  }
  return { message: null, code: null }
}

export function classifyNim(res: AdapterResponse): RateClass | null {
  if (res.status === 429) return 'rate_opaque' // NIM 未给出 429 的细分码
  if (res.status === 401 || res.status === 403) return 'auth'
  if (res.status === 400) {
    const parsed = parseNimError(res.body)
    if (parsed.message !== null && /model/i.test(parsed.message)) return 'model_missing'
  }
  return null
}

export function classifyNimTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown' {
  if (res.status >= 200 && res.status < 300) return 'ok'
  if (res.status >= 500) return 'upstream_5xx'
  if (res.status === 429) return 'unknown'
  if (res.status >= 400) return 'client_4xx'
  return 'unknown'
}

export function nimBackoff(rc: RateClass, attempt: number): Backoff {
  const base = 1_000
  let waitMs = base * Math.pow(2, attempt - 1)
  if (waitMs > 60_000) waitMs = 60_000
  const jitterMs = Math.floor(waitMs * 0.3)
  return { waitMs, jitterMs }
}

export function nimReadHeaders(res: AdapterResponse): HeaderSnapshot | null {
  return null
}

export const NIM_FETCH_USAGE: undefined = undefined

export function nimEmptyCatalog(): { ok: true; models: []; fetchedAt: string } {
  return { ok: true, models: [], fetchedAt: new Date().toISOString() }
}
