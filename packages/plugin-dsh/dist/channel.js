/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page as an HTTP route under CHANNEL, served by this process's web server.
 *
 * Three earlier designs were tried and all three failed in the same place: each assumed the two
 * halves share something that an application process can only be lent. A window key assumed one
 * global. `connection.rpc` assumed a service the browser half receives, and DSH provides that one
 * only inside its own client bundle, not to a plugin a profile loads. Window events assumed one
 * window -- and dispatchEvent did fire on the renderer's, into a bus this Node process was never
 * subscribed to, so the page reported "6 dispatch returned ; no reply in 4000ms".
 *
 * An HTTP route assumes neither. The page asks for it the way DSH desktop's own shell asks for
 * everything: dsh-app://app/<path> is handed by protocol.handle to forwardWebRequest, which
 * reissues the request against this web server with the Host's own cookie attached, and only for
 * the main frame's origin. The authentication is that cookie, checked by ctx.connection.admit
 * before the route is reached, so this file authenticates nothing and stores nothing -- the same
 * promise credentials.ts makes in its first rule. What it does not get is a push channel: a page
 * asks, and the answer stands until the page asks again.
 *
 * Three rules shape the code below.
 *
 * 1. Publishing happens when the caller says so. There is no timer and no subscription of our
 *    own, because a timer here would eventually become a request the user did not make -- the
 *    same mistake docs/05 section 4.3 bans for the dashboard.
 * 2. Absence stays absent. A provider whose usage endpoint has not answered ships without its
 *    numbers, not with zeroes, so the icon has no zero it could mistake for a reading.
 * 3. A command name we do not know is refused, not ignored. Listing the two that exist makes the
 *    extension surface one line long, so adding a third is a diff someone reviews rather than a
 *    typo that silently does nothing.
 *
 * One property is easy to lose here and was lost once already. Both endpoints return JSON, so
 * nothing on the wire may be a function or a live handle -- which is why CommandOutcome carries a
 * KeyReading and not the KeyStatus it was built from. A test that shares the same process cannot
 * notice the difference, so the shape is narrow on purpose.
 */
import { buildSnapshot, PROVIDER_ORDER, serializeSnapshot, } from './vendor/core/index.js';
import { iconViewOf } from './vendor/client-ui/index.js';
/**
 * The path prefix the page asks under, and the two endpoints below it.
 *
 * One segment, no dots and no blanks, because it is also what the renderer spells in a URL and what
 * a second plugin would have to avoid picking. The web server refuses a duplicate prefix outright,
 * so the collision this name could cause is a startup error with a message, not a request answered
 * by the wrong plugin.
 *
 * The payload rule is the one the view itself follows (docs/03): what travels is JSON, never a
 * function, a class instance, or a live handle. Each endpoint names itself in the path (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one more
 * branch in answerOf(), not a second event pair to keep in sync.
 */
export const CHANNEL = '/dsh-multipool';
/**
 * The endpoint names the page may ask for, one path segment under CHANNEL.
 *
 * These have kept their spelling across four transports, so the two halves of this repo still speak
 * one vocabulary; and they are the only part of the request the host trusts before it has looked at
 * the payload.
 */
export const ENDPOINT_SNAPSHOT = 'snapshot';
export const ENDPOINT_COMMAND = 'command';
/** The ref this plugin stores its one key under; the form's field is named after it. */
export const AMD_KEY_REF_NAME = 'AMD_API_KEY';
/** Refused because the name is not one of the two; nothing was attempted. */
export const COMMAND_UNKNOWN = 'unknown command';
/** Refused because a field does not have the type the command needs; nothing was attempted. */
export const COMMAND_MALFORMED = 'malformed command';
/** Refused because this channel was closed before the command arrived. */
export const COMMAND_CLOSED = 'channel is closed';
/** Refused because this install has no credential service to write through. */
export const COMMAND_NO_WRITES = 'no credential service';
export function buildPublishedView(source, budget, pointsProviderId) {
    const snapshot = buildSnapshot({
        accounts: source.accounts(),
        events: source.events(),
        nowMs: source.nowMs(),
        activeSessions: source.activeSessions(),
        queued: source.queued(),
        usage: source.usage(),
    }, PROVIDER_ORDER);
    // attached is true on purpose: the browser half only calls view() when it found this
    // channel, and this file exists only inside the host. The path that flips it back is
    // the browser's missing-channel branch, which never reaches us.
    const reading = source.reading();
    const view = iconViewOf({ snapshot, budget, pointsProviderId, attached: true, reading });
    // The list and the claim about it travel together. serializeSnapshot() cannot carry this -- it
    // counts accounts, and a count of zero is the same number whether the pool was read or not.
    // Absent rather than undefined-valued: a channel with no seam is a shape without the member, and
    // spreading `{ keyLayer: undefined }` into every answer would make "cannot tell" look like "was
    // asked and said nothing" to a page that only checks for the key's presence.
    const layer = source.keyLayer === undefined ? undefined : source.keyLayer();
    return layer === undefined
        ? { snapshot, reading, view, wire: serializeSnapshot(snapshot) }
        : { snapshot, reading, view, layer, wire: serializeSnapshot(snapshot) };
}
/** The name a command request carries. One field, because there is one question. */
const COMMAND_NAME = 'name';
const COMMAND_KEY = 'key';
const SAVE_OR_FORGET = ['save', 'forget'];
/**
 * Run one command, or say why it cannot run.
 *
 * The order matters: closed, then unknown, then no-service. An install with no credential service
 * still refuses a typo as a typo, and does not reach the write path to find out. A refusal carries
 * no `status` -- it did not read, and a status here would be a claim about the seam made without
 * asking it.
 */
async function dispatch(request, writes, isClosed) {
    if (isClosed())
        return { ok: false, reason: COMMAND_CLOSED };
    const fields = request !== null && typeof request === 'object'
        ? request
        : undefined;
    const name = fields === undefined ? undefined : fields[COMMAND_NAME];
    if (typeof name !== 'string' || !SAVE_OR_FORGET.includes(name)) {
        return { ok: false, reason: COMMAND_UNKNOWN };
    }
    if (writes === undefined)
        return { ok: false, reason: COMMAND_NO_WRITES };
    if (name === 'forget')
        return await writes.forget();
    // The key text is passed through as the store will see it: this layer validates the name, not
    // the value, and key-store.ts is where docs/02 section 1.2 and 1.9 decide what a key may be.
    const key = fields === undefined ? undefined : fields[COMMAND_KEY];
    if (typeof key !== 'string')
        return { ok: false, reason: COMMAND_MALFORMED };
    return await writes.save(key);
}
/**
 * Opens the channel and returns the handle.
 *
 * Nothing is installed on the page here: `apply` closes over the handle and registers it with
 * `connection.rpc.handle`, which is the thing that admits a caller. This function only decides
 * what the two endpoints answer.
 */
export function openChannel(options) {
    const pointsProviderId = options.pointsProviderId === undefined
        ? null
        : options.pointsProviderId;
    let writes = options.writes;
    let last = null;
    let closed = false;
    const build = () => buildPublishedView(options.source, options.budget, pointsProviderId);
    return {
        command(request) {
            return dispatch(request, writes, () => closed);
        },
        offer(next) {
            if (closed)
                return;
            writes = next;
        },
        publish() {
            last = build();
            return last;
        },
        isPublished() {
            return last !== null;
        },
        published() {
            return last;
        },
        close() {
            closed = true;
            last = null;
        },
    };
}
/**
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of a request body. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a class
 * instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
 *
 * An unknown endpoint is refused by name. Rule 3 one level up: the set of endpoints is the whole
 * surface a page can reach, so it stays a list somebody reads.
 */
export function answerOf(handle) {
    return async (endpoint, payload) => {
        if (endpoint === ENDPOINT_SNAPSHOT) {
            const built = handle.publish();
            // The layer travels with the view, and only when there is one to send: a page that receives
            // `layer: undefined` cannot tell "no layer was reported" from "this host never reports layers",
            // and the second is a fact about a host nobody has met.
            return built.layer === undefined
                ? { ok: true, value: { view: built.view, reading: built.reading } }
                : { ok: true, value: { view: built.view, reading: built.reading, layer: built.layer } };
        }
        if (endpoint === ENDPOINT_COMMAND) {
            // The payload is { request } rather than the request itself: a command with no fields
            // (`{}`) and a command that never arrived (`undefined`) then stay two different answers,
            // and dispatch() gets to decide which of them is malformed.
            const request = payload !== null && typeof payload === 'object'
                ? payload.request
                : undefined;
            return { ok: true, value: await handle.command(request) };
        }
        return {
            ok: false,
            error: {
                code: 'multipool/unknown-endpoint',
                message: `no endpoint ${JSON.stringify(endpoint)}`,
            },
        };
    };
}
const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};
/** The most request body this route will read, in bytes. A command is a name and a key. */
const MAX_BODY_BYTES = 64 * 1024;
/**
 * Reads one request body as UTF-8, or undefined when it cannot be read at all.
 *
 * `undefined` means the body was unreadable -- too big, or an aborted request -- and is deliberately
 * not the same answer as a body that was read and happens not to be JSON. The caller sends 413 or 400
 * for the first and a repairable "malformed command" for the second, and that difference is the whole
 * difference between a page that can retry and one that cannot.
 */
async function readBody(req) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.byteLength;
        if (size > MAX_BODY_BYTES)
            return undefined;
        parts.push(buffer);
    }
    return Buffer.concat(parts).toString('utf8');
}
/**
 * The web route: POSTs to the two endpoints, JSON in and JSON out.
 *
 * Only POST is answered. A GET is told the method exists and is elsewhere (Allow), rather than being
 * handed a snapshot a link could have prefetched or a cache could have kept: both endpoints speak
 * about this moment in the pool, and this moment has no address. The route is one prefix rather than
 * two exact entries so a third endpoint is a string in this file and a branch in answerOf(), not a
 * second registration somebody has to keep in step with the first.
 *
 * Nothing is read from the cookie here and nothing is set on it. `ctx.connection.admit` has already
 * decided whether the caller reaches a route at all, before this handler is called.
 */
export function routeOf(handle) {
    const answer = answerOf(handle);
    return {
        kind: 'prefix',
        path: CHANNEL,
        handler: async (req, res) => {
            const method = req.method ?? '';
            if (method !== 'POST') {
                // HEAD is answered like GET with an empty body: a caller checking reachability should not
                // have to read a body it was told not to expect.
                res.writeHead(405, {
                    'allow': 'POST',
                    'content-type': 'text/plain; charset=utf-8',
                    'cache-control': 'no-store',
                });
                res.end(method === 'HEAD' ? undefined : 'method not allowed; use POST\n');
                return;
            }
            const endpoint = endpointFrom(req.url);
            const body = await readBody(req);
            if (body === undefined) {
                res.writeHead(413, {
                    'content-type': 'text/plain; charset=utf-8',
                    'cache-control': 'no-store',
                });
                res.end('request body too large or aborted\n');
                return;
            }
            // An empty body is the one endpoint that takes no argument, so it is not a parse failure.
            let payload = undefined;
            if (body !== '') {
                try {
                    payload = JSON.parse(body);
                }
                catch {
                    res.writeHead(400, {
                        'content-type': 'text/plain; charset=utf-8',
                        'cache-control': 'no-store',
                    });
                    res.end('request body is not JSON\n');
                    return;
                }
            }
            const reply = await answer(endpoint, payload);
            res.writeHead(200, JSON_HEADERS);
            res.end(JSON.stringify(reply));
        },
    };
}
/**
 * The endpoint name in a request path, or the empty string when the path is not one of ours.
 *
 * `?` and `#` both end the name here: the URL parser is not called, because this string is one the
 * web server has already matched a prefix against, and what is left is the part it did not.
 *
 * The two cuts are spelled out rather than written as `slice(0, url.indexOf('?'))`, because
 * `indexOf` answers -1 when neither is present and `slice(0, -1)` silently drops the last
 * character -- turning `/dsh-multipool/snapshot` into `snapsho`, which is a name this file has never
 * heard of. That is the same shape as every other failure in docs/09: correct-looking, quiet,
 * and only wrong on the branch the tests did not take.
 */
function endpointFrom(url) {
    if (typeof url !== 'string')
        return '';
    const prefix = CHANNEL + '/';
    const query = url.indexOf('?');
    const fragment = url.indexOf('#');
    let tail = url;
    if (query !== -1)
        tail = tail.slice(0, query);
    if (fragment !== -1)
        tail = tail.slice(0, fragment);
    if (!tail.startsWith(prefix))
        return '';
    const name = tail.slice(prefix.length);
    // A second slash is not a shorter name for this endpoint; it is a different path, refused below.
    return name.includes('/') ? '' : name;
}
/**
 * Claims the route and returns the disposer, or a disposer with nothing claimed.
 *
 * No web server means no route and nothing thrown: the same shape bridgeOf took for a missing window.
 * apply() has to return a disposer either way, and an entry that throws is an entry DSH removes from
 * the page with only a console line left behind (docs/09 section 6.1).
 */
export function serveOn(server, handle) {
    if (server === undefined)
        return () => undefined;
    return server.register(routeOf(handle));
}
//# sourceMappingURL=channel.js.map