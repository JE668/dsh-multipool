/**
 * Points pricing, docs/03-DATA-CONTRACT.md section 3.3 and docs/02-CONSTRAINTS.md section 1.7.
 *
 * AMD publishes prices in two shapes and they are the same numbers in different units:
 *
 *   GET /v1/models  pricing.prompt  "0.00000014"  pts per token
 *   the console     the model card  "0.14"        pts per million tokens
 *
 * 0.14 / 1e6 is exactly 0.00000014, so one table serves both: we keep the per-token
 * strings (they are what the API hands us, untouched) and multiply by 1e6 only when
 * showing a per-million figure. Prices stay strings and the arithmetic is decimal --
 * 02 section 1.7 warns the numbers are small and float multiplication drifts.
 *
 * pts is a quota unit. It is never money, never gets a currency symbol, and there is no
 * documented conversion to currency, so none is offered here (02 section 3).
 */
import { unknownValue } from './contract.js';
import { estimateCost, isDecimalString } from './decimal.js';
/** 02 section 1.7: pricing arrives as a decimal string per token. */
export const PER_MILLION = 1_000_000;
/**
 * The console's unit. Unknown stays null (not 0), so a missing price never renders as free.
 * Kept alongside the original source so the readout can say where the number came from.
 */
function toMillion(value) {
    if (value === undefined)
        return unknownValue('no price for this model');
    if (value.value === null)
        return value;
    const scaled = shiftPoint(value.value, 6);
    if (scaled === null)
        return unknownValue(value.raw ?? value.value);
    return { ...value, value: scaled };
}
/**
 * Move the decimal point right by `places`, string surgery only: 0.00000014 becomes
 * 0.14 exactly. mulDecimalByInt keeps the input's own scale, so 0.00000014 x 1_000_000
 * renders as 252.56 -- eight places overflow and the low digits are lost. A unit
 * conversion needs a shift, not a multiplication.
 */
function shiftPoint(text, places) {
    if (!isDecimalString(text))
        return null;
    const dot = text.indexOf('.');
    const intPart = dot === -1 ? text : text.slice(0, dot);
    const fracPart = dot === -1 ? '' : text.slice(dot + 1);
    const digits = `${intPart}${fracPart}`;
    const point = intPart.length + places;
    if (point <= 0) {
        return `0.${'0'.repeat(-point)}${digits}`;
    }
    const head = trimLeadingZeros(digits.slice(0, point));
    const tail = dropTrailingZeros(digits.slice(point));
    return tail.length === 0 ? head : `${head}.${tail}`;
}
function trimLeadingZeros(text) {
    const trimmed = text.replace(/^0+(?=\d)/, '');
    return trimmed;
}
function dropTrailingZeros(text) {
    return text.replace(/0+$/, '');
}
export function perMillion(price) {
    return {
        unit: price.perCharPrompt === undefined ? 'per_million_tokens' : 'per_million_chars',
        prompt: toMillion(price.prompt ?? price.perCharPrompt),
        completion: toMillion(price.completion),
        inputCacheRead: price.perCharPrompt === undefined
            ? toMillion(price.inputCacheRead)
            : unknownValue('char billing has no cache tier'),
    };
}
/**
 * Cover a price the catalog left blank with a published console figure, keeping the
 * provenance visible: the value carries source 'doc-local' and the ref of the sheet it
 * was read from, so the readout can mark it a local snapshot rather than an API answer.
 * A figure already present from the API wins -- the API is the live price.
 */
export function fallbacks(price, sheet, ref) {
    if (sheet === undefined)
        return price;
    const keep = (api, doc) => api === undefined || api.value === null
        ? doc === undefined
            ? api
            : { value: doc.value, source: 'doc-local', ref, fetchedAt: doc.fetchedAt }
        : api;
    return {
        prompt: keep(price.prompt, sheet.prompt),
        completion: keep(price.completion, sheet.completion),
        inputCacheRead: keep(price.inputCacheRead, sheet.inputCacheRead),
        perCharPrompt: keep(price.perCharPrompt, sheet.perCharPrompt),
    };
}
export function pointsFor(price, usage) {
    // PriceInMillion is a display unit -- pts per million. Billing needs pts per token variants
    // come back down by 1e6 right here, once, instead of at every call site where a forgotten
    // division would bill a request a million times over.
    const promptRate = perToken(price.prompt.value);
    const completionRate = perToken(price.completion.value);
    if (promptRate === null || completionRate === null)
        return null;
    // Cached reads bill at the cache rate when published, else at the plain rate.
    // Never at 0: an unknown cache rate is not a free cache.
    const cacheRate = perToken(price.inputCacheRead.value) ?? promptRate;
    const cacheTokens = usage.cacheReadTokens ?? 0;
    const plainPrompt = Math.max(0, usage.promptTokens - cacheTokens);
    const completionTokens = usage.completionTokens + (usage.reasoningTokens ?? 0);
    const charges = [];
    for (const [tokens, rate] of [[plainPrompt, promptRate], [cacheTokens, cacheRate], [completionTokens, completionRate]]) {
        const charge = estimateCost(tokens, rate);
        if (charge === null)
            return null;
        charges.push(charge);
    }
    return addDecimals(charges);
}
/** Per-million points down to per-token points. */
/** places may be negative: the point moves left and fraction digits grow. */
function perToken(perMillionValue) {
    if (perMillionValue === null)
        return null;
    return shiftPoint(perMillionValue, -6);
}
/** Sum of non-negative decimal strings, by integer scaling. No Number, no drift. */
function addDecimals(values) {
    let places = 0;
    for (const value of values)
        places = Math.max(places, (value.split('.')[1] ?? '').length);
    let total = 0n;
    for (const value of values) {
        const [intPart = '0', fracPart = ''] = value.split('.');
        const digits = `${intPart}${fracPart.padEnd(places, '0')}`;
        total += BigInt(digits);
    }
    // Re-join the scaled integer as a decimal string, then drop the same trailing zeros
    // the rest of decimal.ts drops, so 0.0030 and 0.003 compare equal in readouts.
    const text = total.toString().padStart(places + 1, '0');
    const cut = text.length - places;
    return places === 0 ? text : `${text.slice(0, cut)}.${text.slice(cut)}`;
}
//# sourceMappingURL=pricing.js.map