/**
 * Google Gemini adapter (docs/06 T-8-a, T-8-b, T-8-c, T-8-d, T-8-e; catalog/limits.json google).
 *
 * keyPrefix=AIza（真实 Key 以 AIza 开头，紧跟 35 位 base64url，约 39 字符）。
 * 鉴权：REST 用 x-goog-api-key，OpenAI 兼容端点用 Authorization: Bearer；查询串 ?key= 被禁止。
 * 模型 ID 形状：models/<id>（原生端点），OpenAI 兼容端点 model 不带前缀。前缀拼接/剥离只在适配器内部。
 * Provider 级无单一 RPM：按模型取值，见 freeTier.modelLimits[*].
 * dailyQuota 按模型 rpd；quotaTimezone=America/Los_Angeles。
 * 无用量端点。
 */

import type { AdapterResponse, Backoff, HeaderSnapshot, RateClass, UsageResult } from './contract.js'

export const GOOGLE_KEY_PREFIX = 'AIza'
export const GOOGLE_QUOTA_TIMEZONE = 'America/Los_Angeles'

/** T-8-d: Google has no usage endpoint. Every call reports 'no-endpoint' so callers never
 *  guess a balance from /v1beta/models or any other path. */
export async function googleFetchUsage(_key: string): Promise<UsageResult> {
  return { available: false, reason: 'no-endpoint' }
}

function parseGoogleError(body: string): { message: string | null; code: string | null; quotaId: string | null } {
  try {
    const json = JSON.parse(body)
    if (json && typeof json === 'object') {
      // Google v1beta error shape: { error: { code, message, status } }
      if ('error' in json && json.error !== null && typeof json.error === 'object') {
        const err = json.error as Record<string, unknown>
        return {
          message: typeof err.message === 'string' ? err.message : null,
          code: typeof err.code === 'string' ? err.code : null,
          quotaId: typeof err.quotaId === 'string' ? err.quotaId : null,
        }
      }
      // Direct shape: { error: { message } }
      if (typeof json.error === 'string') {
        return { message: json.error, code: null, quotaId: null }
      }
    }
  } catch {
    // not JSON
  }
  return { message: null, code: null, quotaId: null }
}

export function classifyGoogle(res: AdapterResponse): RateClass | null {
  if (res.status === 429) {
    const parsed = parseGoogleError(res.body)
    // Google 429 can be RPM, RPD, or quotaId-based. A quotaId that names a daily quota
    // means the account won't succeed today: classify as daily_quota, not rate_opaque.
    if (parsed.quotaId !== null && /daily/i.test(parsed.quotaId)) return 'daily_quota'
    return 'rate_opaque' // 需要 quotaId 细分，本地不能猜
  }
  if (res.status === 403) return 'auth' // 403 通常是 API Key 问题
  if (res.status === 404) return 'model_missing' // 模型不存在
  if (res.status === 400) {
    const parsed = parseGoogleError(res.body)
    if (parsed.message !== null && /model/i.test(parsed.message)) return 'model_missing'
  }
  return null
}

export function classifyGoogleTransport(res: AdapterResponse): 'ok' | 'upstream_5xx' | 'client_4xx' | 'network' | 'unknown' {
  if (res.status >= 200 && res.status < 300) return 'ok'
  if (res.status >= 500) return 'upstream_5xx'
  if (res.status === 429) return 'unknown'
  if (res.status >= 400) return 'client_4xx'
  return 'unknown'
}

export function googleBackoff(rc: RateClass, attempt: number): Backoff {
  let waitMs = 1_000 * Math.pow(2, attempt - 1)
  if (waitMs > 60_000) waitMs = 60_000
  const jitterMs = Math.floor(waitMs * 0.3)
  return { waitMs, jitterMs }
}

export function googleReadHeaders(res: AdapterResponse): HeaderSnapshot | null {
  // Google 返回 X-RateLimit-Limit 等头，但按模型取值，适配器层不做全局解析
  return null
}

export { googleFetchUsage as GOOGLE_FETCH_USAGE }

export function googleEmptyCatalog(): { ok: true; models: []; fetchedAt: string } {
  return { ok: true, models: [], fetchedAt: new Date().toISOString() }
}

/** Strip `models/` prefix from native Google model IDs for OpenAI-compat endpoints. */
export function stripModelsPrefix(modelId: string): string {
  return modelId.startsWith('models/') ? modelId.slice(7) : modelId
}

/** Add `models/` prefix for native Google endpoints. */
export function addModelsPrefix(modelId: string): string {
  return modelId.startsWith('models/') ? modelId : `models/${modelId}`
}
