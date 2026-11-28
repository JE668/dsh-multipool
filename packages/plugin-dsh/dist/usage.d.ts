/**
 * The one place this plugin asks AMD for a number (docs/06 T-2-f; docs/02 section 1.5).
 *
 * What it asks for is `GET /v1/usage?include_recent=true` -- the endpoint 02 section 1.5 says to
 * read your own limits from, and the only one whose fields are a tally rather than a charge. It
 * sends nothing else: no prompt, no model, no completion. So a call here consumes zero pts, which
 * is the whole reason a settings form may do it at the press of a button while the proxy it fronts
 * keeps refusing to measure anything by asking.
 *
 * It is not budgeted either, and that is deliberate rather than an oversight. docs/04 counts a
 * request against rpmAccount because the account shares a window with clients this plugin cannot
 * see; a usage read is this plugin looking at its own book, once, because the reader pressed a key.
 * It never happens on a timer (see docs/05 section 4.3: a panel that polls has become a client), so
 * there is no cadence to fold into a budget -- only a person's click, which the 60-second floor in
 * core/amd-usage.ts already bounds.
 *
 * Who sends it: this process, not the seam. `ctx.credentials` answers four questions -- resolve,
 * describe, set, unset -- and sending a request is not one of them. For one round this file asked
 * `seam.fetch` and a missing member was read as "the host cannot ask", which was a sentence about
 * our own wish dressed as a fact about DSH. `resolve` answers the value; attaching it is this
 * module's job, and the whole job ends inside `sendOnce` below: nothing here logs, stores, or
 * reports the value, and the sentences that leave carry the status line instead.
 */
import { type ProviderId, type UsageResult } from '@dsh-multipool/core';
import type { CredentialSeam } from './key-store.js';
import type { DiagnoseResult } from './source.js';
/** Where the upstream usage reading answers, and how it is spelled when it does not. */
export declare const USAGE_PATH = "/usage?include_recent=true";
/** One probe request: POST the smallest possible chat body to read the account's own rate headers. */
export declare const DIAGNOSE_PATH = "/v1/chat/completions";
/** One frame of a probe answer: status, headers, body -- nothing else touches the key. */
export interface ProbeFrame {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}
/** One press of the settings-page "account summary diagnosis" button (T-1-i).
 *
 * Read-only: one POST to the upstream chat endpoint with max_tokens: 1, then report the
 * rate-limit headers it answered with. Writes nothing -- not the key, not any budget field,
 * not the metrics store. The request is real traffic, so it counts against the account's
 * 20 RPM window like any other chat request; this plugin grants it no exemption.
 */
export declare function diagnoseAmd(args: {
    readonly providerId: ProviderId;
    readonly seam: CredentialSeam | undefined;
    readonly reference: string;
    readonly baseUrl?: string;
    readonly nowMs: number;
    readonly lastAttemptMs?: number;
    readonly timeoutMs?: number;
    /** The layer the seam resolved the key in, if it named one. Travels out on the attempt. */
    readonly layer?: string;
}): Promise<DiagnoseResult>;
/** One frame of a reading: the JSON text, or the status line when the text is not the answer. */
export interface UsageFrame {
    readonly status: number;
    readonly body: string;
}
/** Wait no longer than this for the upstream; a form must not hang on a stalled socket. */
export declare const USAGE_TIMEOUT_MS = 15000;
/**
 * How one provider's usage read travels: ask the seam for the value, then send it.
 *
 * Three failures stay three sentences, because they have three different fixes:
 *   - no seam at all: this DSH composed no credential provider (nothing to fill in);
 *   - seam says nothing is stored: the value is missing, not the transport (fill the field);
 *   - seam throws: the store itself is unwell, and its own words are scrubbed and passed through.
 * A seam that answers `undefined` is a reading too -- "absent" is what `keyStateOf` calls it -- and
 * saying "cannot make requests" for it would send the reader to look for the wrong problem.
 */
export declare function usageWire(seam: CredentialSeam | undefined, reference: string, timeoutMs: number): ((url: string) => Promise<UsageFrame>) | undefined;
/** What a press of the test button produces edition: a reading, or the reason there is none. */
export interface UsageAttempt {
    /** Which provider was asked. Beside the answer so a form never has to remember what it pressed. */
    readonly providerId: ProviderId;
    /** The reading, or null when no answer came back. Null and a zero reading are different answers. */
    readonly usage: UsageResult | null;
    /** One sentence for the form. Never the key: `scrubSecrets` runs over everything here. */
    readonly said: string;
    /** Epoch ms this attempt finished, so a second press inside a minute can be refused locally. */
    readonly atMs: number;
    /**
     * True when no request was made because the last one was too recent, and `said` is the sentence
     * explaining which reading the answer is instead -- see the merge branch in readAmdUsage.
     */
    readonly tooSoon: boolean;
    /**
     * True when `usage` is the previous reading carried forward rather than a new one: inside the
     * 60-second floor there is one request per minute, and a second press inside it gets that one
     * request's answer with a sentence that says so. A form may style it differently; it must not
     * print it as a fresh number (docs/07 U-06).
     */
    readonly carried?: boolean;
    /**
     * Which layer the key was found in, when the seam named one.
     *
     * Only the seam knows, and it only answers on the read that found the key -- so the layer has
     * to travel on the reading or it cannot be shown at all without a second request for a fact
     * the first one already had. Absent when nothing is stored, or when the seam declined to name
     * a layer: an unnamed layer is not a guessable one (key-store.ts:94).
     */
    readonly layer?: string;
}
/**
 * Fetch the account's usage once, and say what happened in words a form can print.
 *
 * Every branch is a different sentence because they are different facts: no seam at all, a seam
 * that cannot send, a non-2xx answer with the upstream's own words, a 2xx whose body is not the
 * shape we read, and finally a reading. Collapsing them into "failed" would be the same mistake
 * the icon's dashes were: one glyph for five things.
 */
export declare function readAmdUsage(args: {
    readonly providerId: ProviderId;
    readonly seam: CredentialSeam | undefined;
    readonly reference: string;
    readonly baseUrl?: string;
    readonly nowMs: number;
    readonly lastAttemptMs?: number;
    readonly previous?: UsageResult;
    readonly timeoutMs?: number;
    /** The layer the seam resolved the key in, if it named one. Travels out on the attempt. */
    readonly layer?: string;
}): Promise<UsageAttempt>;
/** Put one reading into the map the snapshot reads, or take the provider's entry out. */
export declare function withProviderUsage(usage: Readonly<Partial<Record<string, UsageResult | null>>> | undefined, providerId: string, reading: UsageResult | null): Readonly<Partial<Record<string, UsageResult | null>>>;
//# sourceMappingURL=usage.d.ts.map