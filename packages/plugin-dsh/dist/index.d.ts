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
import { type Account } from '@dsh-multipool/core';
import { type RouteServer } from './channel.js';
import { type KeyContext, type KeyStatus } from './credentials.js';
import type { CredentialSeam, KeyState } from './key-store.js';
import { channelSourceFrom, type SourceFacts } from './source.js';
export declare const VERSION = "0.0.2-rc.4";
/**
 * The rail's second line is the account budget, and 04 section 2.2 says where that comes from:
 * computeBudget over the admission policy, not a constant this file keeps.
 *
 * It used to be 0 with an empty source list, and the page printed what it was given -- "global
 * RPM 0 (-)" on a machine that was serving. Zero is this module's most expensive possible default,
 * because it is the one number that reads as a measurement rather than as a missing value.
 *
 * headerRemaining is null: the response headers of a chat request are not visible to a plugin
 * loaded from a profile, so the 0.85 admission margin stands in for them, exactly as the gate's
 * own start-up state does. 02 section 1.3 still owns the reading, and 04 section 6.4 still says a
 * header can only lower this number.
 */
export declare const RAIL_BUDGET: import("@dsh-multipool/core").Budget;
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
     * Offer the write half to the page's command() (T-2-e). On by default as of T-2-f.
     *
     * The settings page has shipped and the save button is real, so the write half is no longer a
     * promise about a surface that does not exist: docs/06 T-2-f asks for it to be on in the same
     * commit the button lands in, and this is the commit that decides it.
     *
     * Pass `false` to keep it off -- a test of a read-only install, or an embedder that vouches
     * for its own credentials and does not want this plugin holding a write path. The injection still
     * happens (the icon still needs it), it just carries no `writes` offer.
     */
    readonly acceptsWrites?: boolean;
    /**
     * Step 2 gate: when true, a `tryAcquire` that returns `ok: false` causes the request
     * to be rejected outright (429-like response, no upstream call). Defaults to false --
     * step 1 is read-only: the gate is consulted and its budget observed, but nothing is
     * refused, nothing is delayed, nothing changes a routing decision.
     */
    readonly rejectOnBudgetExhausted?: boolean;
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
/**
 * How far the pool has been read, in the source's own words.
 *
 * `SourceFacts` keeps each member optional, and that is enough for "one provider has no reading".
 * It is not enough for "nobody has read the pool yet" once `accounts ?? []` has turned the absence
 * into a list: from then on every count is a confident zero. So the third answer travels beside the
 * list instead of being inferred from it, and the badge prints a dash for it.
 */
export type MutableFacts = {
    -readonly [K in keyof SourceFacts]: SourceFacts[K];
} & {
    reading?: 'unread' | 'read' | 'empty';
};
/**
 * The one account a single stored key amounts to.
 *
 * An empty list when the seam said there is no key: that is a reading too, and the icon draws 0/0
 * for it on purpose. `undefined` only when the state is not an answer about the pool at all --
 * `refused` and `unavailable` mean the question did not get through, and reporting "empty" on the
 * pool's behalf would be exactly the lie U-06 names.
 */
export declare function accountFrom(state: KeyState): readonly Account[] | undefined;
/**
 * Read the key now, keep reading it when the seam says the reference moved, and hand back one disposer.
 *
 * The disposer covers both halves, so a disabled plugin leaves nothing behind: no listener on the
 * seam's event, and no promise still writing into the facts object afterwards.
 *
 * The first read is not cached. key-store.ts resolves again on each operation, and a cached answer
 * here would freeze "the store said no" into the icon's first paint forever.
 */
export declare function reportKeyInto(context: KeyContext, facts: MutableFacts, onRead?: (status: KeyStatus) => void): () => void;
/** The channel's lifetime is the plugin's lifetime. */
export declare function apply(ctx: {
    effect(callback: () => () => void): () => void;
    inject?: (names: string[], callback: (child: InjectedServices) => void) => () => void;
    llm?: {
        stream: (options: {
            provider: string;
            model: string;
            messages: unknown[];
            signal?: AbortSignal;
        }) => AsyncIterable<unknown>;
    };
}, options?: HostOptions): () => void;
export { NOTHING_READ, channelSourceFrom, type SourceFacts } from './source.js';
export { AMD_KEY_REF, CREDENTIALS_SERVICE, KEY_UPDATED_EVENT, clearKeyStatus, readKeyStatus, watchKeyStatus, writeKeyStatus, type KeyContext, type KeyStatus, type KeyWriteOutcome, } from './credentials.js';
export { AMD_KEY_REFS, KNOWN_LAYERS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey, type AmdKeyRef, type CredentialSeam, type KeyState, type KeyWrite } from './key-store.js';
export { CHANNEL, ENDPOINT_COMMAND, ENDPOINT_DASHBOARD, ENDPOINT_READING, ENDPOINT_SNAPSHOT, ENDPOINT_TEST, answerOf, buildPublishedView, openChannel, routeOf, serveOn, type BridgeAnswer, type BridgeRequest, type BridgeResponse, type Channel, type ChannelHandle, type ChannelSource, type IconBudget, type OpenChannelOptions, type PublishedView, type Route, type RouteServer, } from './channel.js';
export { createIntercept, type InterceptOptions, type InterceptHandle } from './intercept-index.js';
//# sourceMappingURL=index.d.ts.map