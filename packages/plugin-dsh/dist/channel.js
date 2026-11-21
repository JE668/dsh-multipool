/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last put on one window key. Nothing else crosses: not the key
 * store, not the scheduler, not the proxy -- except a command, which travels the other way on
 * that same key and only when the page asks for one (T-2-e).
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
 */
import { buildSnapshot, PROVIDER_ORDER, serializeSnapshot, } from './vendor/core/index.js';
import { iconViewOf } from './vendor/client-ui/index.js';
/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export const CHANNEL_KEY = '@dsh-multipool/plugin-client/view';
/** The real global object, addressed as `ChannelTarget`. */
function globalTarget() {
    return {
        write(key, value) {
            ;
            globalThis[key] = value;
        },
    };
}
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
/** republish() before publish() has nothing to send, and a silent empty send reads as a bug. */
const NO_SUBSCRIBERS = 'publish() has not run yet; there is no view to re-send';
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
 * The window key is installed before this returns, so the browser half always has something
 * to call -- even if the first publish() has not happened yet, view() builds a snapshot on
 * demand.
 */
export function openChannel(options) {
    const target = options.target === undefined ? globalTarget() : options.target;
    const pointsProviderId = options.pointsProviderId === undefined
        ? null
        : options.pointsProviderId;
    const subscribers = new Set();
    let writes = options.writes;
    let last = null;
    let closed = false;
    const build = () => buildPublishedView(options.source, options.budget, pointsProviderId);
    const channel = {
        view() {
            if (last === null)
                last = build();
            return last.view;
        },
        subscribe(listener) {
            if (closed)
                return () => undefined;
            subscribers.add(listener);
            // A late subscriber gets today's view rather than a dash until the next publish -- the
            // host being up is exactly what it should not have to wait to learn.
            if (last !== null)
                listener(last.view);
            return () => {
                subscribers.delete(listener);
            };
        },
        command(request) {
            return dispatch(request, writes, () => closed);
        },
        offer(next) {
            if (closed)
                return;
            writes = next;
        },
    };
    target.write(CHANNEL_KEY, channel);
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
            const next = build();
            last = next;
            // Publishing after close() would put the key back on a window that already unloaded us.
            if (closed)
                return next;
            for (const listener of subscribers)
                listener(next.view);
            return next;
        },
        republish() {
            if (last === null)
                throw new Error(NO_SUBSCRIBERS);
            if (!closed)
                for (const listener of subscribers)
                    listener(last.view);
            return last;
        },
        isPublished() {
            return last !== null;
        },
        close() {
            closed = true;
            subscribers.clear();
            target.write(CHANNEL_KEY, undefined);
            last = null;
        },
    };
}
//# sourceMappingURL=channel.js.map