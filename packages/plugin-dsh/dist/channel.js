/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page over `connection.rpc` (dsh-client-connection), not over a window
 * key. That key used to be the design: the host wrote a live object onto globalThis, and the
 * page read it. It could not work, because the two halves are two processes and globalThis is
 * one per process -- but the tests all passed, since a test hands both halves the same global.
 * An HTTP channel is what both processes can actually reach, and it brings the authentication
 * this file would otherwise have had to invent: `rpc.handle` admits, this module answers.
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
 * The RPC channel the page calls.
 *
 * One segment, and no slash inside it: dsh-client-connection tests a host channel against
 * /^\/[A-Za-z0-9._~-]+$/ and refuses the rest, reserving `/api` for the gateway it owns itself.
 * Rejected channel names fail at registration, so this constant is the only place the name is
 * spelled -- an endpoint below only ever appends one segment to it.
 */
export const CHANNEL = '/multipool';
/** The two endpoints `CHANNEL` serves; every other name is refused, see dispatch(). */
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
/**
 * The `connection.rpc.handle` callback: one JSON payload per endpoint name, one JSON answer.
 *
 * `handler` is handed the endpoint the caller asked for and a payload that is already plain JSON.
 * Both endpoints answer in the shape the transport on the other side parses -- { ok, value } or
 * { ok: false, error } -- and neither answer may carry a function, a class instance, or a live
 * handle.
 *
 * An unknown endpoint is refused by name. The same argument as rule 3 above applies one level up:
 * the set of endpoints is the whole surface a page can reach, so it stays a list somebody reads.
 */
export function handleOf(handle) {
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
//# sourceMappingURL=channel.js.map