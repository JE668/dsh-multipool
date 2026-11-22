/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page over two `window` events agreed on below, not over a window key.
 *
 * Two earlier designs were tried and both failed in the same place. A key failed because the two
 * halves are two processes unrestrained by anything but hope: the host wrote, the page read
 * nothing, and every test passed because a test hands both halves one global. `connection.rpc`
 * (dsh-client-connection) then failed because the browser half provides that service only inside
 * DSH's own client bundle, not to a plugin loaded from a profile -- no `connection` on the page,
 * `ctx.inject(['connection'], ...)` never called back, and the icon drew dashes while the host it
 * could not reach was running fine.
 *
 * What is left is the window both halves demonstrably share in DSH desktop, which is the
 * renderer's. The cost is stated here rather than discovered later: a window event carries no
 * authentication, so this is a same-process conversation, and any script already running on the
 * page could answer in the host's place. Nothing in this file claims otherwise (docs/09).
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
 * The two window events the halves talk over.
 *
 * `page` is what the page dispatches and the host listens for; `host` is the answer, and it names
 * the side that sends it rather than the side that receives it, so neither name has to be read
 * from the other's point of view. Both are namespaced under `dsh-multipool:` because a window
 * event bus is shared with every other plugin in the profile, and an unprefixed name is a
 * collision waiting for the second plugin to be written.
 *
 * The payload rule is the same one the view itself follows (docs/03): what travels is JSON, never
 * a function, a class instance, or a live handle. Each event names its endpoint (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one
 * more branch in dispatch(), not a second event pair to keep in sync.
 */
export const BRIDGE_EVENT = 'dsh-multipool:bridge';
export const BRIDGE_REPLY = 'dsh-multipool:bridge-reply';
/**
 * The endpoint names the page may ask for over BRIDGE_EVENT.
 *
 * These used to be RPC endpoint names under CHANNEL = '/multipool'. They keep their spelling so the
 * two halves of this repo still speak one vocabulary, and they are now the only part of the
 * request the host trusts before it has looked at the payload.
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
    const view = iconViewOf({ snapshot, budget, pointsProviderId, attached: true });
    return { snapshot, view, wire: serializeSnapshot(snapshot) };
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
        close() {
            closed = true;
            last = null;
        },
    };
}
/** The fields a bridge request carries. Anything else on the object is ignored, not merged. */
const BRIDGE_CALL = 'callId';
const BRIDGE_ENDPOINT = 'endpoint';
const BRIDGE_PAYLOAD = 'payload';
function eventCtor() {
    const global = globalThis;
    return global.CustomEvent ?? global.Event ?? undefined;
}
function replyOn(where, wire) {
    const Ctor = eventCtor();
    if (Ctor === undefined)
        return;
    where.dispatchEvent(new Ctor(BRIDGE_REPLY, { detail: wire }));
}
/**
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of the event. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a
 * class instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
 *
 * An unknown endpoint is refused by name. Rule 3 one level up: the set of endpoints is the whole
 * surface a page can reach, so it stays a list somebody reads.
 */
export function answerOf(handle) {
    return async (endpoint, payload) => {
        if (endpoint === ENDPOINT_SNAPSHOT) {
            return { ok: true, value: handle.publish().view };
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
            error: { code: 'multipool/unknown-endpoint', message: `no endpoint ${JSON.stringify(endpoint)}` },
        };
    };
}
/**
 * Reads one BRIDGE_EVENT detail, or nothing when this event is not ours.
 *
 * Kept apart from the listener so a test can hand it a plain object and never touch a window. A
 * detail with no string callId or no string endpoint is not a malformed request to refuse -- it is
 * somebody else's event, or a stray dispatch with no fields, and the ordinary answer to both is to
 * not answer.
 */
export function readBridgeRequest(detail) {
    if (detail === null || typeof detail !== 'object')
        return undefined;
    const fields = detail;
    const callId = fields[BRIDGE_CALL];
    const endpoint = fields[BRIDGE_ENDPOINT];
    if (typeof callId !== 'string' || callId === '')
        return undefined;
    if (typeof endpoint !== 'string' || endpoint === '')
        return undefined;
    return { callId, endpoint, payload: fields[BRIDGE_PAYLOAD] };
}
/** globalThis, seen as the one thing a window event needs to be. */
function globalBridge() {
    return globalThis;
}
/**
 * Wires BRIDGE_EVENT on `target` to `handle`, and sends each answer back on BRIDGE_REPLY.
 *
 * The two events are how the halves reach each other now. The page dispatches one; this process
 * listens, answers, and dispatches the other with the caller's own callId, so two requests in
 * flight cannot swap answers. `target` is `globalThis` in DSH, where host and page are the same
 * Electron renderer -- which is also the whole reason there is no authentication here (docs/09).
 *
 * The returned disposer removes the listener, and is what makes a disable leave nothing behind on
 * the bus: the same promise route registration made, now checkable without a web server.
 */
export function bridgeOf(handle, target = undefined) {
    // The default is resolved here rather than in the parameter list: an explicit undefined --
    // which is what options.target is when a host passes no window -- would wipe out a default.
    const where = target === undefined ? globalBridge() : target;
    const answer = answerOf(handle);
    const onRequest = (event) => {
        const request = readBridgeRequest(event !== null && typeof event === 'object'
            ? event.detail
            : undefined);
        if (request === undefined)
            return;
        answer(request.endpoint, request.payload).then((reply) => {
            const wire = reply.ok
                ? { callId: request.callId, ok: true, value: reply.value }
                : { callId: request.callId, ok: false, error: reply.error };
            replyOn(where, wire);
        }, (thrown) => {
            // An endpoint that threw still owes the caller an answer, or the page waits forever for a
            // callId that will never come back. The message is the throw's own, not a rewrite of it.
            replyOn(where, {
                callId: request.callId,
                ok: false,
                error: {
                    code: 'multipool/endpoint-threw',
                    message: thrown instanceof Error ? thrown.message : String(thrown),
                },
            });
        });
    };
    where.addEventListener(BRIDGE_EVENT, onRequest);
    return () => {
        where.removeEventListener(BRIDGE_EVENT, onRequest);
    };
}
//# sourceMappingURL=channel.js.map