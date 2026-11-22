/**
 * Host half of dsh-multipool.
 *
 * The plugin puts one window bridge (packages/plugin-dsh/src/channel.ts) in front of the page and
 * hands it the facts it has. Scheduling, the key store and the local proxy arrive in their own
 * tasks; until they do, those facts are "nothing has been read yet", which source.ts spells as
 * `undefined` rather than as zero.
 *
 * Entry points for the DSH loader:
 *
 * - No `inject` on purpose. `slots` lives in the browser half (dsh-cordis-client-runner), so
 *   naming it here parked this entry in "pending (waiting for service: slots)" forever -- the
 *   host fiber would never see it. `apply` reads nothing but `ctx.effect` and `ctx.inject`, which
 *   every context has.
 * - The bridge is `window` events, and asks for no service at all (T-2-b). It used to be
 *   `connection.rpc.handle` on a web route; that never activated, because `connection` is provided
 *   inside DSH's own client bundle and not to a plugin loaded from a profile, so the injection never
 *   called back and the icon dashed while the host was running fine. Two events need no provider.
 *   The trade is stated in docs/09: no authentication, so the page is trusted.
 * - `credentials` is asked for with `ctx.inject`, never listed in `inject`, and takes no part in
 *   whether this plugin activates (T-2-e). A key is what makes it able to send, not what makes it
 *   load: a DSH built without dsh-credentials-local (or with it disabled) must still show the icon,
 *   and the icon's honest answer there is "no credential service", not a refused plugin. The
 *   child's status is reported through `onKeyStatus` and nothing else in this file waits on it.
 * - `apply(ctx)` opens the channel and attaches the bridge listener inside `ctx.effect`, so
 *   disabling the plugin detaches it and leaves no listener behind, and publishing stays
 *   pull-based: `apply` opens, it does not publish. Nothing here schedules a timer of its own
 *   (docs/05 section 4.3).
 * - The clock is the injected one a caller passes in. This file never reads Date.now, so the
 *   icon's timestamps can be replayed exactly in a test that controls time (07 Z-03).
 */
import { createSystemClock } from './vendor/core/index.js';
import { AMD_KEY_REF_NAME, openChannel, serveOn, CHANNEL, COMMAND_NO_WRITES, } from './channel.js';
import { CREDENTIALS_SERVICE, readKeyStatus, clearKeyStatus, watchKeyStatus, writeKeyStatus, } from './credentials.js';
import { NOTHING_READ, channelSourceFrom } from './source.js';
export const VERSION = '0.0.2-rc.4';
/** The icon prints this until a task computes the real account budget (04 section 2.2). */
export const NO_BUDGET_SOURCES = [];
export const NO_ADMIT_RPM = 0;
/** The store's answer, turned into what the page's command() hands back. */
function outcomeOf(result) {
    const status = result.status;
    if (status.kind === 'read') {
        const state = status.state;
        // The seam object is dropped here, not by the page: it is a live handle with four methods, and
        // the icon only ever needed to know whether a key is now there.
        const reading = state.kind === 'configured'
            ? { present: true, layer: state.layer }
            : { present: false };
        // "refused" and "unavailable" reach the page as their own words: one says the store answered with
        // an error, the other that there was no store to answer. Neither is the page's fault, and a form
        // that printed an unfilled field for either would be the mild lie this branch exists to avoid.
        return state.kind === 'configured'
            ? { ok: true, status: reading, message: result.message }
            : { ok: false, reason: state.kind, status: reading, message: result.message };
    }
    return { ok: false, reason: COMMAND_NO_WRITES, message: result.message };
}
const writesFor = (seam) => ({
    save: (key) => writeKeyStatus({ credentials: seam }, key, AMD_KEY_REF_NAME).then(outcomeOf),
    forget: () => clearKeyStatus({ credentials: seam }, AMD_KEY_REF_NAME).then(outcomeOf),
});
/**
 * The service dsh-host-webserver registers. The namespaced package is the implementation; this is the
 * only spelling a context answers a get() for.
 */
export const WEB_SERVER_SERVICE = 'webServer';
/**
 * ctx.inject, or a no-op when the context predates the mixin.
 *
 * Both of apply()'s injections go through here, so "this DSH has no inject" stays one branch instead of
 * two, and a context that cannot inject is still a context the icon activates on.
 */
function injectOf(ctx, names, callback) {
    const inject = ctx.inject;
    if (typeof inject !== 'function')
        return () => undefined;
    // A body that threw is caught here, and only here.
    //
    // Both injections run from inside the effect app-cordis runs to load this entry. inject() resolves
    // a *mock* when some of the names are absent, and a mock whose miss handler was not written yet
    // throws -- even from a property read this file never asked about, which is how a TypeError on
    // `target` took the whole entry down and the icon with it. The rule this file already states is
    // that the plugin must activate on a DSH with no carrier and draw dashes there; a dashed icon is
    // still an icon, but a throw is nothing at all, and the user sees the plugin disappear.
    //
    // Catching costs the route: where inject succeeds, handle() is registered and the icon answers.
    // Where it throws, there was no route to be had anyway, and the icon answers the dash -- the same
    // answer it gives on a DSH that predates connection. Silently, because a user cannot act on
    // "your other service's mock was incomplete".
    try {
        return inject.call(ctx, names, callback);
    }
    catch {
        return () => undefined;
    }
}
/**
 * The one account a single stored key amounts to.
 *
 * An empty list when the seam said there is no key: that is a reading too, and the icon draws 0/0
 * for it on purpose. `undefined` only when the state is not an answer about the pool at all --
 * `refused` and `unavailable` mean the question did not get through, and reporting "empty" on the
 * pool's behalf would be exactly the lie U-06 names.
 */
export function accountFrom(state) {
    if (state.kind === 'configured') {
        // Only the members an Account can carry without inventing any. No keyIdMasked: describe() never
        // returns a preview for env layers, and inventing one is the lie key-store.ts rule 3 prevents.
        return [
            {
                providerId: 'amd',
                accountAlias: AMD_KEY_REF_NAME,
                keyIdMasked: '',
                enabled: true,
                // Empty, not filled: nothing in this file has read the account's limits, and a number here
                // would be the plugin's own guess wearing an Account's clothes (docs/03).
                limits: {},
                status: 'available',
            },
        ];
    }
    if (state.kind === 'absent')
        return [];
    return undefined;
}
/**
 * Read the key now, keep reading it when the seam says the reference moved, and hand back one disposer.
 *
 * The disposer covers both halves, so a disabled plugin leaves nothing behind: no listener on the
 * seam's event, and no promise still writing into the facts object afterwards.
 *
 * The first read is not cached. key-store.ts resolves again on each operation, and a cached answer
 * here would freeze "the store said no" into the icon's first paint forever.
 */
export function reportKeyInto(context, facts, onRead) {
    const sink = onRead ?? (() => undefined);
    const apply = (status) => {
        if (status.kind !== 'read')
            return;
        const accounts = accountFrom(status.state);
        if (accounts === undefined)
            return;
        facts.accounts = accounts;
        sink(status);
    };
    // watchKeyStatus() already reads once on its way in, so there is no separate first read here:
    // two would mean the seam is asked twice for one icon paint, and the second answer would be the
    // one that lands.
    return watchKeyStatus(context, apply);
}
/** The channel's lifetime is the plugin's lifetime. */
export function apply(ctx, options = {}) {
    const nowMs = options.nowMs ?? (() => createSystemClock().now());
    return ctx.effect(() => {
        // The one object the seam writes into. It starts as NOTHING_READ -- every member absent, none
        // zero -- and only a read that came back may change it, because `reading()` is derived from
        // `accounts` being undefined here and nowhere else.
        const facts = { ...(options.facts ?? NOTHING_READ) };
        const source = channelSourceFrom(facts, nowMs);
        const budget = { admitRpm: NO_ADMIT_RPM, sources: NO_BUDGET_SOURCES };
        const channel = openChannel({ source, budget });
        const drops = [];
        const server = options.server;
        if (server === undefined) {
            drops.push(injectOf(ctx, [WEB_SERVER_SERVICE], child => {
                const webServer = child.webServer;
                if (webServer === undefined)
                    return;
                drops.push(serveOn(webServer, channel));
            }));
        }
        else {
            drops.push(serveOn(server, channel));
        }
        // Asked for unconditionally, which is the point of T-2-b's last leg. This injection used to be
        // armed only when a reader or a writer had been handed in, and an install the user merely enabled
        // hands in neither -- so the seam was never resolved, the facts never said who was there, and the
        // icon painted 0/0: a confident number about a pool nobody had looked .A reason to
        // paint is a reason to read, and the icon always has one.
        const onKeyStatus = options.onKeyStatus;
        drops.push(injectOf(ctx, [CREDENTIALS_SERVICE], child => {
            const seam = child.credentials;
            // No seam at all stays indistinguishable from one that has not answered yet, and both read as
            // 'unread' downstream. That is deliberate: "I could not tell" is not "there are none".
            if (seam === undefined)
                return;
            drops.push(reportKeyInto(child, facts, onKeyStatus));
            // The write half is handed to the page, not used here. apply() still writes nothing itself.
            if (options.acceptsWrites === true)
                channel.offer(writesFor(seam));
        }));
        return () => {
            for (const drop of drops.reverse())
                drop();
            channel.close();
        };
    });
}
export { NOTHING_READ, channelSourceFrom } from './source.js';
export { AMD_KEY_REF, CREDENTIALS_SERVICE, KEY_UPDATED_EVENT, clearKeyStatus, readKeyStatus, watchKeyStatus, writeKeyStatus, } from './credentials.js';
export { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey } from './key-store.js';
export { CHANNEL, ENDPOINT_COMMAND, ENDPOINT_SNAPSHOT, answerOf, buildPublishedView, openChannel, routeOf, serveOn, } from './channel.js';
//# sourceMappingURL=index.js.map