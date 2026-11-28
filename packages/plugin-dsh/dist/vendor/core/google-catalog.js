/**
 * Google model catalog (docs/06 T-8-b; catalog/limits.json google).
 *
 * Google's native endpoint returns models with `name` like "models/gemini-4-hydrogen".
 * The OpenAI-compat endpoint returns IDs without the prefix. The adapter strips/adds
 * the prefix internally -- callers see unprefixed IDs.
 *
 * Google does not publish a single provider-level RPM: each model has its own
 * limits in freeTier.modelLimits / liveModelLimits. Those live in catalog/limits.json
 * and are read by the host, not by this file.
 *
 * No usage endpoint: dailyQuota remains unknown (docs/07 H-10).
 */
import { unknownValue } from './contract.js';
/** 02 §1.5 default cadence for a refresh, shared with AMD catalog. */
export const CATALOG_REFRESH_MS = 600_000;
const STABILITY_VALUES = ['stable', 'beta', 'unstable', 'experimental'];
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    return typeof value === 'string' ? value : null;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return null;
    const out = value.filter((x) => typeof x === 'string');
    return out.length === value.length ? out : null;
}
function priceString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
function pricingOf(raw) {
    const block = asRecord(raw['pricing']);
    if (block === null)
        return null;
    const prompt = priceString(block['prompt']);
    const completion = priceString(block['completion']);
    const inputCacheRead = priceString(block['input_cache_read']);
    const perCharPrompt = priceString(block['per_char_prompt']);
    const pricingUnit = perCharPrompt === null ? 'tokens' : 'chars';
    const out = { pricingUnit };
    if (prompt !== null)
        out.prompt = { value: prompt, source: 'api' };
    if (completion !== null)
        out.completion = {
            value: completion,
            source: 'api',
        };
    if (inputCacheRead !== null)
        out.inputCacheRead = {
            value: inputCacheRead,
            source: 'api',
        };
    if (perCharPrompt !== null)
        out.perCharPrompt = {
            value: perCharPrompt,
            source: 'api',
        };
    return out;
}
function sourced(value) {
    return value === null ? unknownValue() : { value, source: 'api' };
}
function stabilityOf(value) {
    const s = asString(value);
    if (s === null)
        return undefined;
    return STABILITY_VALUES.includes(s) ? { value: s, source: 'api' } : undefined;
}
/** Strip the `models/` prefix Google's native endpoint uses for display IDs. */
function stripNativePrefix(id) {
    return id.startsWith('models/') ? id.slice(7) : id;
}
/** One raw Google catalog entry -> NormalizedModel. Absent fields stay absent. */
export function normalizeGoogleModel(raw, nowIso) {
    const name = asString(raw['name']);
    if (name === null || name.length === 0)
        return null;
    const id = stripNativePrefix(name);
    const capabilities = {};
    // Google reports capabilities at the top level, not per provider block.
    for (const key of ['tools', 'vision', 'reasoning']) {
        const v = raw[key];
        if (typeof v === 'boolean')
            capabilities[key] = { value: v, source: 'api' };
    }
    const jsonOutput = raw['jsonOutput'] ?? raw['json_output'];
    if (typeof jsonOutput === 'boolean')
        capabilities.jsonMode = { value: jsonOutput, source: 'api' };
    const ctx = raw['contextLength'] ?? raw['context_length'];
    const contextLength = typeof ctx === 'number' && Number.isFinite(ctx) ? { value: ctx, source: 'api' } : undefined;
    const model = {
        providerId: 'google',
        id,
        fetchedAt: nowIso,
        capabilities,
    };
    const displayName = asString(raw['displayName'] ?? raw['display_name']);
    const family = asString(raw['family']);
    const params = asStringArray(raw['supportedParameters'] ?? raw['supported_parameters']);
    const pricing = pricingOf(raw);
    const stability = stabilityOf(raw['stability']);
    // Google doesn't publish a `free` field per model in catalog responses; missing = cost guarded.
    const freeField = unknownValue();
    const costGuard = true;
    return {
        ...model,
        displayName: displayName ?? id,
        ...(family === null ? {} : { family: sourced(family) }),
        ...(params === null ? {} : { supportedParameters: sourced(params) }),
        ...(contextLength === undefined ? {} : { contextLength }),
        ...(pricing === null ? { pricing: null } : { pricing }),
        ...(stability === undefined ? {} : { stability }),
        free: freeField,
        costGuard,
    };
}
/** Parse Google's catalog body into NormalizedModel[]. Empty/unreadable body yields []. */
export function parseGoogleCatalogResponse(body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return [];
    }
    const root = asRecord(parsed);
    if (root === null)
        return [];
    // Google v1beta returns { models: [...] } at the top level.
    const list = root['models'];
    if (!Array.isArray(list))
        return [];
    const nowIso = new Date(0).toISOString();
    const out = [];
    for (const entry of list) {
        const raw = asRecord(entry);
        if (raw === null)
            continue;
        const model = normalizeGoogleModel(raw, nowIso);
        if (model !== null)
            out.push(model);
    }
    return out;
}
/** Every entry of a loose list -> NormalizedModel[]. Google-specific parser. */
export function normalizeGoogleModels(list) {
    const nowIso = new Date(0).toISOString();
    const out = [];
    for (const entry of list) {
        const raw = asRecord(entry);
        if (raw === null)
            continue;
        const model = normalizeGoogleModel(raw, nowIso);
        if (model !== null)
            out.push(model);
    }
    return out;
}
const cache = new Map();
function epochIso(ms) {
    return new Date(ms).toISOString();
}
/**
 * GET models through the injected clock only (Z-03: no bare Date.now).
 *
 * Cache hit inside CATALOG_REFRESH_MS returns the previous snapshot without touching
 * the socket. A failed refresh keeps the old snapshot with staleSince stamped.
 */
export async function fetchGoogleCatalog(key, nowMs, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', transport) {
    const cached = cache.get(key);
    if (cached !== undefined && nowMs - cached.atMs < CATALOG_REFRESH_MS) {
        return cached.result;
    }
    const attempt = await requestGoogleCatalog(key, baseUrl, nowMs, transport);
    if (!attempt.ok && cached !== undefined) {
        const stale = { ...cached.result, staleSince: epochIso(nowMs) };
        cache.set(key, { atMs: nowMs, result: stale });
        return stale;
    }
    cache.set(key, { atMs: nowMs, result: attempt });
    return attempt;
}
/** Tests only: drop every cached snapshot. */
export function resetGoogleCatalogCache() {
    cache.clear();
}
async function requestGoogleCatalog(key, baseUrl, nowMs, transport) {
    const fetchedAt = epochIso(nowMs);
    if (transport === undefined) {
        return { ok: false, models: [], fetchedAt, error: 'no transport configured' };
    }
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    try {
        const res = await transport(url, { headers: { authorization: `Bearer ${key}` } });
        const body = await res.text();
        if (res.status < 200 || res.status >= 300) {
            return { ok: false, models: [], fetchedAt, error: `status ${res.status}` };
        }
        return { ok: true, models: parseGoogleCatalogResponse(body), fetchedAt };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, models: [], fetchedAt, error: message };
    }
}
//# sourceMappingURL=google-catalog.js.map