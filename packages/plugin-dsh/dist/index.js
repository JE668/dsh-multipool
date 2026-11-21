/**
 * Host half of dsh-multipool.
 *
 * The plugin registers one channel (packages/plugin-dsh/src/channel.ts) on the page's window and
 * hands it the facts it has. Scheduling, the key store and the local proxy arrive in their own
 * tasks; until they do, those facts are "nothing has been read yet", which source.ts spells as
 * `undefined` rather than as zero.
 *
 * Entry points for the DSH loader:
 *
 * - No `inject` on purpose. `slots` lives in the browser half (dsh-cordis-client-runner), so
 *   naming it here parked this entry in "pending (waiting for service: slots)" forever -- the
 *   host fiber would never see it, and the icon never got a chance to ask for the sidebar slot.
 *   `apply` reads nothing but `ctx.effect`, which every context has.
 * - `credentials` is asked for with `ctx.inject`, never listed in `inject`, and takes no part in
 *   whether this plugin activates (T-2-e). A key is what makes it able to send, not what makes it
 *   load: a DSH built without dsh-credentials-local (or with it disabled) must still show the icon,
 *   and the icon's honest answer there is "no credential service", not a refused plugin. The
 *   child's status is reported through `onKeyStatus` and nothing else in this file waits on it.
 * - `apply(ctx)` opens the channel inside `ctx.effect`, so disabling the plugin disposes it and
 *   leaves no `window` key behind, and publishing stays pull-based: `apply` opens, it does not
 *   publish. Nothing here schedules a timer of its own (docs/05 section 4.3).
 * - The clock is the injected one a caller passes in. This file never reads Date.now, so the
 *   icon's timestamps can be replayed exactly in a test that controls time (07 Z-03).
 */
import { createSystemClock } from './vendor/core/index.js';
import { AMD_KEY_REF_NAME, openChannel, COMMAND_NO_WRITES, } from './channel.js';
import { CREDENTIALS_SERVICE, clearKeyStatus, watchKeyStatus, writeKeyStatus, } from './credentials.js';
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
/** The channel's lifetime is the plugin's lifetime. */
export function apply(ctx, options = {}) {
    const nowMs = options.nowMs ?? (() => createSystemClock().now());
    return ctx.effect(() => {
        const source = channelSourceFrom(options.facts ?? NOTHING_READ, nowMs);
        const budget = { admitRpm: NO_ADMIT_RPM, sources: NO_BUDGET_SOURCES };
        const channel = openChannel({ source, budget });
        const drops = [];
        // Off unless somebody reads the answer: an enabled plugin with no form open must not show up in
        // the page's listener table, which is what the comment above "no inject" promises in practice.
        const onKeyStatus = options.onKeyStatus;
        const inject = ctx.inject;
        // Neither a reader nor a writer means no listener: the injection below is the one thing that would
        // put this plugin in the page's event table with nothing to do there.
        if (typeof inject === 'function' && (onKeyStatus !== undefined || options.acceptsWrites === true)) {
            drops.push(inject.call(ctx, [CREDENTIALS_SERVICE], child => {
                const seam = child.credentials;
                if (seam === undefined)
                    return;
                if (onKeyStatus !== undefined)
                    drops.push(watchKeyStatus(child, onKeyStatus));
                // The write half is handed to the page, not used here. apply() still writes nothing itself.
                if (options.acceptsWrites === true)
                    channel.offer(writesFor(seam));
            }));
        }
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
export { CHANNEL_KEY, buildPublishedView, openChannel, } from './channel.js';
//# sourceMappingURL=index.js.map