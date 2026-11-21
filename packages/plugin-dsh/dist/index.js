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
import { openChannel } from './channel.js';
import { CREDENTIALS_SERVICE, watchKeyStatus } from './credentials.js';
import { NOTHING_READ, channelSourceFrom } from './source.js';
export const VERSION = '0.0.2-rc.3';
/** The icon prints this until a task computes the real account budget (04 section 2.2). */
export const NO_BUDGET_SOURCES = [];
export const NO_ADMIT_RPM = 0;
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
        if (onKeyStatus !== undefined && typeof ctx.inject === 'function') {
            drops.push(ctx.inject([CREDENTIALS_SERVICE], child => {
                drops.push(watchKeyStatus(child, onKeyStatus));
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
export { AMD_KEY_REF, CREDENTIALS_SERVICE, KEY_UPDATED_EVENT, readKeyStatus, watchKeyStatus } from './credentials.js';
export { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey } from './key-store.js';
export { CHANNEL_KEY, buildPublishedView, openChannel, } from './channel.js';
//# sourceMappingURL=index.js.map