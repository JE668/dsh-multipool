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
import { type RouteServer } from './channel.js';
import { type KeyStatus } from './credentials.js';
import type { CredentialSeam } from './key-store.js';
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
    /**
     * The web server to claim CHANNEL on. Defaults to the `webServer` service, which is where DSH puts
     * it and where the page's dsh-app://app fetch already reaches.
     *
     * A test has no web server and should not need one: it passes four lines here -- a register that
     * keeps the route, and a disposer that drops it -- and then calls the route's handler with its own
     * request and response.
     */
    readonly server?: RouteServer;
}
/**
 * The service dsh-host-webserver registers. The namespaced package is the implementation; this is the
 * only spelling a context answers a get() for.
 */
export declare const WEB_SERVER_SERVICE = "webServer";
/**
 * What an injection hands back: whichever of the named services the context has.
 *
 * Two are here. `credentials` carries the key (T-2-e), and `webServer` carries the route the page
 * reaches it by. Both are optional for the same reason: activate first, and say what is missing in
 * the icon, never in a throw that removes the entry from the page.
 */
interface InjectedServices {
    readonly credentials?: CredentialSeam;
    readonly webServer?: RouteServer;
}
/** The channel's lifetime is the plugin's lifetime. */
export declare function apply(ctx: {
    effect(callback: () => () => void): () => void;
    inject?: (names: string[], callback: (child: InjectedServices) => void) => () => void;
}, options?: HostOptions): () => void;
export { NOTHING_READ, channelSourceFrom, type SourceFacts } from './source.js';
export { AMD_KEY_REF, CREDENTIALS_SERVICE, KEY_UPDATED_EVENT, clearKeyStatus, readKeyStatus, watchKeyStatus, writeKeyStatus, type KeyContext, type KeyStatus, type KeyWriteOutcome, } from './credentials.js';
export { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey, type AmdKeyRef, type CredentialSeam, type KeyLayer, type KeyState, type KeyWrite } from './key-store.js';
export { CHANNEL, ENDPOINT_COMMAND, ENDPOINT_SNAPSHOT, answerOf, buildPublishedView, openChannel, routeOf, serveOn, type BridgeAnswer, type BridgeRequest, type BridgeResponse, type Channel, type ChannelHandle, type ChannelSource, type IconBudget, type OpenChannelOptions, type PublishedView, type Route, type RouteServer, } from './channel.js';
//# sourceMappingURL=index.d.ts.map