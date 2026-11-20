/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last put on one window key. Nothing else crosses: not the key
 * store, not the scheduler, not the proxy.
 *
 * Two rules shape the code below.
 *
 * 1. Publishing happens when the caller says so. There is no timer and no subscription of our
 *    own, because a timer here would eventually become a request the user did not make -- the
 *    same mistake docs/05 section 4.3 bans for the dashboard.
 * 2. Absence stays absent. A provider whose usage endpoint has not answered ships without its
 *    numbers, not with zeroes, so the icon has no zero it could mistake for a reading.
 */
import { buildSnapshot, PROVIDER_ORDER, serializeSnapshot, } from './vendor/core/index.js';
import { iconViewOf } from './vendor/client-ui/index.js';
/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export const CHANNEL_KEY = '@dsh-multipool/plugin-client/view';
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
/**
 * Opens the channel and returns the handle.
 *
 * The window key is installed before this returns, so the browser half always has something
 * to call -- even if the first publish() has not happened yet, view() builds a snapshot on
 * demand.
 */
export function openChannel(options) {
    const target = options.target === undefined
        ? globalThis
        : options.target;
    const pointsProviderId = options.pointsProviderId === undefined
        ? null
        : options.pointsProviderId;
    const subscribers = new Set();
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
    };
    target.setProperty(CHANNEL_KEY, channel);
    return {
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
            target.setProperty(CHANNEL_KEY, undefined);
            last = null;
        },
    };
}
//# sourceMappingURL=channel.js.map