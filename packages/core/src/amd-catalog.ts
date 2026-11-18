/**
 * AMD model catalog (docs/02 §1.7; docs/07 A-09..A-11, A-14).
 *
 * Two official facts shape this file more than the payload shape does:
 *   1. "Listing models does not take a concurrency slot, but it does count against
 *      the per-minute limit" -- so every refresh goes through the same budget as a
 *      chat call, serially, and a 10 minute cache is the default rather than an
 *      optimisation.
 *   2. The list is identical for every API Key on the account, so it is cached per
 *      provider, not per Key.
 *
 * The payload is a bare {data: [...]} with no `object`, no `owned_by`, no `created`.
 * A parser that requires an OpenAI-shaped wrapper would report an empty catalog for
 * a perfectly good gateway, so nothing here treats those absent fields as errors.
 */

import type {
  ModelCatalogResult,
  NormalizedModel,
  NormalizedPricing,
  Sourced,
  Stability,
} from './contract.js'
import { unknownValue } from './contract.js'

/** 02 §1.5 default cadence for a refresh, and 03 §8's floor of the same number. */
export const CATALOG_REFRESH_MS = 600_000

const STABILITY_VALUES: readonly Stability[] = ['stable', 'beta', 'unstable', 'experimental']

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out = value.filter((x): x is string => typeof x === 'string')
  return out.length === value.length ? out : null
}

/** A price as the gateway sent it: always a decimal string, never parsed into a number. */
function priceString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Pricing block. `free` lives at model level in 02 §1.7, but pricing objects also
 * appear per provider; we only read the model-level one here.
 */
function pricingOf(raw: Record<string, unknown>): NormalizedPricing | null {
  const block = asRecord(raw['pricing'])
  if (block === null) return null
  const prompt = priceString(block['prompt'])
  const completion = priceString(block['completion'])
  const inputCacheRead = priceString(block['input_cache_read'])
  const perCharPrompt = priceString(block['per_char_prompt'])
  const pricingUnit: NormalizedPricing['pricingUnit'] = perCharPrompt === null ? 'tokens' : 'chars'
  const out: { pricingUnit: 'tokens' | 'chars'; prompt?: Sourced<string>; completion?: Sourced<string>; inputCacheRead?: Sourced<string>; perCharPrompt?: Sourced<string> } = {
    pricingUnit,
  }
  if (prompt !== null) (out as { prompt?: Sourced<string> }).prompt = { value: prompt, source: 'api' }
  if (completion !== null) (out as { completion?: Sourced<string> }).completion = { value: completion, source: 'api' }
  if (inputCacheRead !== null) (out as { inputCacheRead?: Sourced<string> }).inputCacheRead = { value: inputCacheRead, source: 'api' }
  if (perCharPrompt !== null) (out as { perCharPrompt?: Sourced<string> }).perCharPrompt = { value: perCharPrompt, source: 'api' }
  return out
}

function sourced<T>(value: T | null): Sourced<T> {
  return value === null ? unknownValue<T>() : { value, source: 'api' }
}

function stabilityOf(value: unknown): Sourced<Stability> | undefined {
  const s = asString(value)
  if (s === null) return undefined
  return STABILITY_VALUES.includes(s as Stability) ? { value: s as Stability, source: 'api' } : undefined
}

/** One raw catalog entry -> NormalizedModel. An absent field stays absent: never 0, never false. */
export function normalizeModel(raw: Record<string, unknown>, nowIso: string): NormalizedModel | null {
  const id = asString(raw['id'])
  if (id === null || id.length === 0) return null

  const capabilities: NormalizedModel['capabilities'] = {}
  const providers = Array.isArray(raw['providers']) ? raw['providers'] : []
  const first = providers.length > 0 ? asRecord(providers[0]) : null

  for (const key of ['tools', 'vision', 'reasoning'] as const) {
    const v = first?.[key]
    if (typeof v === 'boolean') capabilities[key] = { value: v, source: 'api' }
  }
  const jsonOutput = raw['json_output']
  if (typeof jsonOutput === 'boolean') capabilities.jsonMode = { value: jsonOutput, source: 'api' }
  const structured = raw['structured_outputs']
  if (typeof structured === 'boolean') capabilities.structuredOutputs = { value: structured, source: 'api' }

  const ctx = raw['context_length']
  const contextLength = typeof ctx === 'number' && Number.isFinite(ctx) ? { value: ctx, source: 'api' as const } : undefined

  const model: NormalizedModel = {
    providerId: 'amd',
    id,
    fetchedAt: nowIso,
    capabilities,
  }
  const name = asString(raw['name'])
  const family = asString(raw['family'])
  const params = asStringArray(raw['supported_parameters'])
  const pricing = pricingOf(raw)
  const stability = stabilityOf(raw['stability'])
  // 02 §1.7: free:true == "counted at zero cost against your daily quota", never "not
  // counted". Anything else (false, or the field missing) means the model can spend pts,
  // so it is cost guarded. A missing field is never read as a freebie.
  const freeRaw = raw['free']
  const freeField: Sourced<boolean> =
    freeRaw === true ? { value: true, source: 'api' } : freeRaw === false ? { value: false, source: 'api' } : unknownValue<boolean>()
  const costGuard = freeRaw !== true
  return {
    ...model,
    displayName: name ?? id,
    ...(family === null ? {} : { family: sourced(family) }),
    ...(params === null ? {} : { supportedParameters: sourced(params) }),
    ...(contextLength === undefined ? {} : { contextLength }),
    ...(pricing === null ? { pricing: null } : { pricing }),
    ...(stability === undefined ? {} : { stability }),
    free: freeField,
    costGuard,
  }
}

/** Parse the raw gateway body into model records. An empty or unreadable body yields []. */
export function parseCatalogResponse(body: string): NormalizedModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  const root = asRecord(parsed)
  if (root === null) return []
  const list = root['data']
  if (!Array.isArray(list)) return []
  return normalizeModels(list, 'amd')
}

/** Every entry of a loose list -> NormalizedModel[]. Free semantics live in one place: below. */
export function normalizeModels(list: readonly unknown[], providerId: string): NormalizedModel[] {
  if (providerId !== 'amd') {
    throw new Error(`normalizeModels: no catalog parser for provider '${providerId}' yet`)
  }
  const nowIso = new Date(0).toISOString()
  const out: NormalizedModel[] = []
  for (const entry of list) {
    const raw = asRecord(entry)
    if (raw === null) continue
    const model = normalizeModel(raw, nowIso)
    if (model !== null) out.push(model)
  }
  return out
}

/** Per-key cache entry for fetchCatalog: the round trip is shared, so two callers cost one RPM. */
interface CacheEntry {
  readonly atMs: number
  readonly result: ModelCatalogResult
}

const cache = new Map<string, CacheEntry>()

function epochIso(ms: number): string {
  const iso = new Date(ms).toISOString()
  return iso
}

/**
 * GET /v1/models through the injected clock only (Z-03: no bare Date.now here).
 *
 * A cache hit inside CATALOG_REFRESH_MS returns the previous snapshot without touching
 * the socket. A failed refresh is NOT a failure of the whole catalog: keep the old
 * snapshot, stamp staleSince on it hungover, and report ok=true so the caller can keep
 * serving -- 07 A-14 says a refresh costs RPM, and spending it to end up with nothing is
 * the worst trade available.
 */
export async function fetchCatalog(
  key: string,
  nowMs: number,
  baseUrl = 'https://developer.amd.com.cn/radeon/api/v1',
): Promise<ModelCatalogResult> {
  const cached = cache.get(key)
  if (cached !== undefined && nowMs - cached.atMs < CATALOG_REFRESH_MS) {
    return cached.result
  }

  const attempt: ModelCatalogResult = await requestCatalog(key, baseUrl, nowMs)
  if (!attempt.ok && cached !== undefined) {
    const stale: ModelCatalogResult = { ...cached.result, staleSince: epochIso(nowMs) }
    cache.set(key, { atMs: nowMs, result: stale })
    return stale
  }
  cache.set(key, { atMs: nowMs, result: attempt })
  return attempt
}

/** Tests only: drop every cached snapshot so cadence arithmetic starts from zero. */
export function resetCatalogCache(): void {
  cache.clear()
}

/** No real HTTP client lives in core: callers inject one so tests never touch the network. */
export type FetchLike = (url: string, init: { readonly headers: Record<string, string> }) => Promise<{
  readonly status: number
  text(): Promise<string>
}>

let transport: FetchLike | null = null

export function setCatalogTransport(next: FetchLike | null): void {
  transport = next
}

async function requestCatalog(key: string, baseUrl: string, nowMs: number): Promise<ModelCatalogResult> {
  const fetchedAt = epochIso(nowMs)
  if (transport === null) {
    return { ok: false, models: [], fetchedAt, error: 'no transport configured' }
  }
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`
  try {
    const res = await transport(url, { headers: { authorization: `Bearer ${key}` } })
    const body = await res.text()
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, models: [], fetchedAt, error: `status ${res.status}` }
    }
    return { ok: true, models: parseCatalogResponse(body), fetchedAt }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, models: [], fetchedAt, error: message }
  }
}
