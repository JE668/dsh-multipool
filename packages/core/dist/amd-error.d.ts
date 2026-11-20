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
import type { AdapterResponse, ErrorShell, ParsedError, RateClass, TransportKind } from './contract.js';
/**
 * Parse an AMD error body. Never throws; never invents a message.
 *
 * Precedence follows the official advice (02 section 1.8): read body.error if it is
 * there; otherwise read body.detail.error; otherwise treat body.detail as the error.
 * The Anthropic shell is tested first because it also has an `error` key but nests the
 * payload one level deeper and identifies itself with type: 'error'.
 */
export declare function parseAmdError(body: string | null | undefined): ParsedError;
export declare function headerOf(res: AdapterResponse, name: string): string | undefined;
/**
 * Retry-After of a response in milliseconds, measured against the caller's clock.
 * nowMs is required on purpose: a missing clock number silently turns every HTTP-date
 * form into "already overdue" and the cooldown would read as 0 ms.
 */
export declare function retryAfterMsOf(res: AdapterResponse, nowMs: number): number | null;
export interface AmdDiagnostic {
    readonly status: number;
    /** The first 2 KiB of the body, verbatim (07 Z-07): never summarized, never dropped. */
    readonly raw: string;
    readonly shell: ErrorShell;
}
export interface AmdVerdict {
    readonly rateClass: RateClass | null;
    readonly transport: TransportKind;
    /** As the platform asked. null means it asked for nothing, not "zero". */
    readonly retryAfterMs: number | null;
    readonly diagnostic: AmdDiagnostic;
}
/**
 * Rate class for one AMD response, or null when the outcome is a transport one.
 *
 * Deliberately narrow: only the two shapes 02 section 1.8 documents for AMD are read. A
 * 404 is NOT translated to model_missing here -- AMD's documented miss is a 400
 * "Requested model <name> not supported", and inventing a second spelling would let a
 * real 404 (path typo) masquerade as "the model retired, refresh the catalog".
 */
export declare function classifyAmdRateClass(res: AdapterResponse, parsed: ParsedError, retryAfterMs: number | null): RateClass | null;
/** Transport outcome for one AMD response (docs/03 section 4: never a MetricsEvent.rateKind). */
export declare function classifyAmdTransportKind(res: AdapterResponse): TransportKind;
/**
 * Whole classification in one call: the rate class, the transport boundary, and the
 * diagnostics ring entry. `nowMs` comes from the caller's clock; nothing here reads a timer.
 */
export declare function classifyAmd(res: AdapterResponse, nowMs: number): AmdVerdict;
//# sourceMappingURL=amd-error.d.ts.map