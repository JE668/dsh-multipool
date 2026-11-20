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
import { type Account, type MetricsEvent, type ProviderId, type Snapshot, type UsageResult } from '@dsh-multipool/core';
import { type IconView } from '@dsh-multipool/plugin-client';
/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export declare const CHANNEL_KEY = "@dsh-multipool/plugin-client/view";
/** What the browser half calls. Mirrors the shape client.js expects on window[CHANNEL_KEY]. */
export interface Channel {
    readonly view: () => IconView;
    readonly subscribe: (listener: (view: IconView) => void) => () => void;
}
export interface ChannelSource {
    readonly accounts: () => readonly Account[];
    readonly events: () => readonly MetricsEvent[];
    /** Latest /v1/usage reading per provider; a provider with none stays out of the map. */
    readonly usage: () => Readonly<Partial<Record<ProviderId, UsageResult | null>>>;
    readonly activeSessions: () => number;
    readonly queued: () => number;
    /** The one clock. This module never reads Date.now itself. */
    readonly nowMs: () => number;
}
/** The account-level budget the icon prints, already computed by whatever owns the formula. */
export interface IconBudget {
    readonly admitRpm: number;
    readonly sources: readonly string[];
}
/**
 * Narrow seam over the global object, so a test can hand in a bare one.
 *
 * Both members are plain property assignment on purpose: the host process has no `window`, and
 * `globalThis` has no `setProperty` -- the first install died on `target.setProperty is not a
 * function` for assuming one. The browser half finds the key by reading `window[CHANNEL]`, so a
 * property that is simply there is what it needs; no method has to be invented to put it there.
 */
export interface ChannelTarget {
    readonly write: (key: string, value: unknown) => void;
}
export interface PublishedView {
    readonly snapshot: Snapshot;
    readonly view: IconView;
    /** The scrubbed JSON. Kept beside the view so a test can assert the wire carries no key. */
    readonly wire: string;
}
export interface OpenChannelOptions {
    readonly source: ChannelSource;
    readonly budget: IconBudget;
    readonly target?: ChannelTarget;
    /** Which provider line three's point count comes from; null prints only the dash. */
    readonly pointsProviderId?: ProviderId | null;
}
export interface ChannelHandle {
    /** Rebuild from current state, hand the result to every subscriber, and return it. */
    readonly publish: () => PublishedView;
    /** Re-send the last built view without reading the source again. */
    readonly republish: () => PublishedView;
    readonly isPublished: () => boolean;
    /** Drop every subscriber and remove the window key. The channel is dead afterwards. */
    readonly close: () => void;
}
export declare function buildPublishedView(source: ChannelSource, budget: IconBudget, pointsProviderId: ProviderId | null): PublishedView;
/**
 * Opens the channel and returns the handle.
 *
 * The window key is installed before this returns, so the browser half always has something
 * to call -- even if the first publish() has not happened yet, view() builds a snapshot on
 * demand.
 */
export declare function openChannel(options: OpenChannelOptions): ChannelHandle;
//# sourceMappingURL=channel.d.ts.map