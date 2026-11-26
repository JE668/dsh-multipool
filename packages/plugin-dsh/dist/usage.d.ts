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
 * The key itself never appears in this file's answers or in its errors: the seam is asked to make
 * the request, and the sentences that leave here are this module's own.
 */
import { type ProviderId, type UsageResult } from '@dsh-multipool/core';
import type { CredentialSeam } from './key-store.js';
/** Where the upstream usage reading answers, and how it is spelled when it does not. */
export declare const USAGE_PATH = "/usage?include_recent=true";
/** One frame of a reading: the JSON text, or the status line when the text is not the answer. */
export interface UsageFrame {
    readonly status: number;
    readonly body: string;
}
/**
 * Make the request the seam can make, or nothing when it cannot make one.
 *
 * The seam is whatever `dsh-credentials-localhid` hands over; its `fetch` does the sending, the
 * credential header, and the proxy. This module does not know how the key is attached and must not
 * learn: a transport that took the key as a string would be a second place the key exists, and the
 * first rule of this repo is that there is one.
 */
export declare function usageWire(seam: CredentialSeam | undefined): ((url: string) => Promise<UsageFrame>) | undefined;
/** What a press of the test button produces: a reading, or the reason there is none. */
export interface UsageAttempt {
    /** Which provider was asked. Beside the answer so a form never has to remember what it pressed. */
    readonly providerId: ProviderId;
    /** The reading, or null when no answer came back. Null and a zero reading are different answers. */
    readonly usage: UsageResult | null;
    /** One sentence for the form. Never the key: `scrubSecrets` runs over everything here. */
    readonly said: string;
    /** Epoch ms this attempt finished, so a second press inside a minute can be refused locally. */
    readonly atMs: number;
    /** True when the attempt was not even made because the last one was too recent. */
    readonly tooSoon: boolean;
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
    readonly baseUrl?: string;
    readonly nowMs: number;
    readonly lastAttemptMs?: number;
    readonly previous?: UsageResult;
}): Promise<UsageAttempt>;
/** Put one reading into the map the snapshot reads, or take the provider's entry out. */
export declare function withProviderUsage(usage: Readonly<Partial<Record<string, UsageResult | null>>> | undefined, providerId: string, reading: UsageResult | null): Readonly<Partial<Record<string, UsageResult | null>>>;
//# sourceMappingURL=usage.d.ts.map