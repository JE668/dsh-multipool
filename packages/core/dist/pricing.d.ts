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
import { type Sourced } from './contract.js';
/** 02 section 1.7: pricing arrives as a decimal string per token. */
export declare const PER_MILLION = 1000000;
export interface PriceInput {
    /** pts per token, as the catalog sent it. */
    readonly prompt?: Sourced<string>;
    readonly completion?: Sourced<string>;
    readonly inputCacheRead?: Sourced<string>;
    /** AMD OmniVoice and friends bill by character, not by tokens. */
    readonly perCharPrompt?: Sourced<string>;
}
export interface PriceInMillion {
    readonly unit: 'per_million_tokens' | 'per_million_chars';
    readonly prompt: Sourced<string>;
    readonly completion: Sourced<string>;
    readonly inputCacheRead: Sourced<string>;
}
export declare function perMillion(price: PriceInput): PriceInMillion;
/**
 * Cover a price the catalog left blank with a published console figure, keeping the
 * provenance visible: the value carries source 'doc-local' and the ref of the sheet it
 * was read from, so the readout can mark it a local snapshot rather than an API answer.
 * A figure already present from the API wins -- the API is the live price.
 */
export declare function fallbacks(price: PriceInput, sheet: PriceInput | undefined, ref: string): PriceInput;
/**
 * The points a finished request is worth, per 02 section 1.6: cached input is charged at
 * input_cache_read, the rest of the prompt at prompt, and completion at completion.
 * Reasoning tokens are billed as completion -- they were generated, even when the API
 * reports them outside completion_tokens.
 *
 * A usage class with no price makes the whole result null. A partial sum would read as
 * cheaper than the request really was, and under-reporting a quota is how a Key gets
 * 429ed at the reset boundary.
 */
export interface PointsUsage {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly reasoningTokens?: number;
    readonly cacheReadTokens?: number;
}
export declare function pointsFor(price: PriceInMillion, usage: PointsUsage): string | null;
//# sourceMappingURL=pricing.d.ts.map