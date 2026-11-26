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
import { USAGE_POLL_FLOOR_MS, parseUsageResponse, PROVIDER_BASE_URLS, scrubSecrets, } from './vendor/core/index.js';
/** Where the upstream usage reading answers, and how it is spelled when it does not. */
export const USAGE_PATH = '/usage?include_recent=true';
/**
 * Make the request the seam can make, or nothing when it cannot make one.
 *
 * The seam is whatever `dsh-credentials-localhid` hands over; its `fetch` does the sending, the
 * credential header, and the proxy. This module does not know how the key is attached and must not
 * learn: a transport that took the key as a string would be a second place the key exists, and the
 * first rule of this repo is that there is one.
 */
export function usageWire(seam) {
    if (seam === undefined)
        return undefined;
    const send = seam.fetch;
    if (send === undefined)
        return undefined;
    return async (url) => {
        const response = await send(url, { method: 'GET' });
        return { status: response.status, body: await response.text() };
    };
}
/**
 * Fetch the account's usage once, and say what happened in words a form can print.
 *
 * Every branch is a different sentence because they are different facts: no seam at all, a seam
 * that cannot send, a non-2xx answer with the upstream's own words, a 2xx whose body is not the
 * shape we read, and finally a reading. Collapsing them into "failed" would be the same mistake
 * the icon's dashes were: one glyph for five things.
 */
export async function readAmdUsage(args) {
    const tooSoon = {
        providerId: args.providerId,
        usage: null,
        said: '',
        atMs: args.nowMs,
        tooSoon: true,
    };
    if (args.lastAttemptMs !== undefined && args.nowMs - args.lastAttemptMs < USAGE_POLL_FLOOR_MS) {
        return tooSoon;
    }
    const base = args.baseUrl ?? PROVIDER_BASE_URLS.amd ?? '';
    const wire = usageWire(args.seam);
    if (wire === undefined) {
        // Two different facts, kept apart: no seam is a DSH without a credential provider, a seam with
        // no fetch is one that only describes. A form that printed the second for the first would send
        // the reader to look for a provider they already have.
        const said = args.seam === undefined
            ? 'no credential service on this context, so nothing was asked upstream'
            : 'this credential service cannot make requests, so nothing was asked upstream';
        return { providerId: args.providerId, usage: null, said, atMs: args.nowMs, tooSoon: false };
    }
    const url = base.replace(/\/$/, '') + USAGE_PATH;
    let frame;
    try {
        frame = await wire(url);
    }
    catch (error) {
        // The transport's own words, scrubbed: a fetch error can quote a URL that carries a query.
        return {
            providerId: args.providerId,
            usage: null,
            said: 'upstream unreachable: ' + scrubSecrets(error instanceof Error ? error.message : String(error)),
            atMs: args.nowMs,
            tooSoon: false,
        };
    }
    if (frame.status < 200 || frame.status >= 300) {
        // The status and the upstream's first line, not a summary: "401 Login required" tells the reader
        // their key is not attached, and any paraphrase of it would be this file guessing.
        const first = firstLineOf(frame.body, 160);
        const said = 'HTTP ' + String(frame.status) + (first === '' ? '' : ': ' + first);
        return { providerId: args.providerId, usage: null, said: scrubSecrets(said), atMs: args.nowMs, tooSoon: false };
    }
    const usage = parseUsageResponse(frame.body, new Date(args.nowMs).toISOString());
    if (usage.available !== true) {
        // A 2xx whose body did not parse keeps the previous reading behind it, the way core's poller does:
        // the old number is still what the account said, and its own timestamp says how old it is.
        const carried = args.previous === undefined ? null : { ...args.previous, available: false, reason: 'failed' };
        return {
            providerId: args.providerId,
            usage: carried,
            said: 'the upstream answered ' + String(frame.status) + ' but the body was not a usage reading',
            atMs: args.nowMs,
            tooSoon: false,
        };
    }
    return { providerId: args.providerId, usage, said: '', atMs: args.nowMs, tooSoon: false };
}
/** Put one reading into the map the snapshot reads, or take the provider's entry out. */
export function withProviderUsage(usage, providerId, reading) {
    const next = { ...(usage ?? {}) };
    if (reading === null) {
        // Removed rather than set to null: `null` is the map's word for "there is no usage endpoint here",
        // and an attempt that failed is not that claim. Absent keeps the two apart.
        delete next[providerId];
        return next;
    }
    next[providerId] = reading;
    return next;
}
/**
 * The upstream's own opening sentence, trimmed to something a form can hold.
 *
 * Collapsed whitespace and a hard cap rather than a parse: on an error the interesting part of a
 * body is the sentence the server chose, not a structure this plugin would have to guess at for
 * every provider. 160 characters is enough for "Login required" and long enough that a truncated
 * one still says which kind of refusal it was.
 */
function firstLineOf(body, cap) {
    return body.replace(/\s+/g, ' ').trim().slice(0, cap);
}
//# sourceMappingURL=usage.js.map