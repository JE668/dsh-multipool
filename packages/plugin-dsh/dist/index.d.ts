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
import { type KeyContext, type KeyStatus } from './credentials.js';
import { channelSourceFrom } from './source.js';
export declare const VERSION = "0.0.2-rc.4";
/** The icon prints this until a task computes the real account budget (04 section 2.2). */
export declare const NO_BUDGET_SOURCES: readonly string[];
export declare const NO_ADMIT_RPM = 0;
export interface HostOptions {
    /** Facts to publish. Defaults to NOTHING_READ: no scheduler has run, so nothing is claimed. */
    readonly facts?: Parameters<typeof channelSourceFrom>[0];
    /** Read wall-clock milliseconds. Defaults to the system clock from core/clock.ts. */
    readonly nowMs?: () => number;
    /**
     * Where the seam's answer goes. Called once when the plugin arms, and again after every
     * `credentials/reference-updated` that names this plugin's reference -- no other schedule exists.
     */
    readonly onKeyStatus?: (status: KeyStatus) => void;
    /**
     * Offer the write half to the page's command() (T-2-e). Off unless asked for.
     *
     * A host that takes no writes never resolves `credentials` at all, so an install without a
     * credential provider stays absent from it instead of being described as missing one.
     */
    readonly acceptsWrites?: boolean;
}
/** The channel's lifetime is the plugin's lifetime. */
export declare function apply(ctx: {
    effect(callback: () => () => void): () => void;
    inject?(names: string[], callback: (child: KeyContext) => void): () => void;
}, options?: HostOptions): () => void;
export { NOTHING_READ, channelSourceFrom, type SourceFacts } from './source.js';
export { AMD_KEY_REF, CREDENTIALS_SERVICE, KEY_UPDATED_EVENT, clearKeyStatus, readKeyStatus, watchKeyStatus, writeKeyStatus, type KeyContext, type KeyStatus, type KeyWriteOutcome, } from './credentials.js';
export { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey, type AmdKeyRef, type CredentialSeam, type KeyLayer, type KeyState, type KeyWrite } from './key-store.js';
export { CHANNEL_KEY, buildPublishedView, openChannel, type Channel, type ChannelHandle, type ChannelSource, type ChannelTarget, type IconBudget, type OpenChannelOptions, type PublishedView, } from './channel.js';
//# sourceMappingURL=index.d.ts.map