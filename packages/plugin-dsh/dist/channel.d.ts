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
import { type Account, type MetricsEvent, type ProviderId, type Snapshot, type UsageResult } from '@dsh-multipool/core';
import { type IconView } from '@dsh-multipool/plugin-client';
import type { KeyLayer } from './key-store.js';
/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export declare const CHANNEL_KEY = "@dsh-multipool/plugin-client/view";
/** What the browser half calls. Mirrors the shape client.js expects on window[CHANNEL_KEY]. */
export interface Channel {
    readonly view: () => IconView;
    readonly subscribe: (listener: (view: IconView) => void) => () => void;
    /**
     * Ask the host to do one named thing.
     *
     * The only message that travels from page to host. Its argument is `unknown` because the page
     * is the one place a command arrives without having been typed: a name this file has never
     * heard of is a refusal, never a TypeError thrown into the caller's click handler.
     */
    readonly command: (request: unknown) => Promise<CommandOutcome>;
    /**
     * Attach the write half after `openChannel`.
     *
     * The write seam reaches `apply` through `ctx.inject`, which resolves later than the channel is
     * opened, so the channel has to accept it late -- and refuse commands until it does, rather than
     * answering "no credential service" about a service that simply has not arrived yet.
     */
    readonly offer: (writes: ChannelWrites) => void;
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
/** The ref this plugin stores its one key under; the form's field is named after it. */
export declare const AMD_KEY_REF_NAME = "AMD_API_KEY";
/**
 * What the page may ask the host to do.
 *
 * `save` and `forget` are the only two, and they are deliberately not a generic "write this
 * somewhere": each names one seam method (set, unset) and the one reference it may touch. A page
 * that could ask for an arbitrary ref would be asking this plugin to hold somebody else's key.
 */
export type ChannelCommandName = 'save' | 'forget';
/** Refused because the name is not one of the two; nothing was attempted. */
export declare const COMMAND_UNKNOWN = "unknown command";
/** Refused because a field does not have the type the command needs; nothing was attempted. */
export declare const COMMAND_MALFORMED = "malformed command";
/** Refused because this channel was closed before the command arrived. */
export declare const COMMAND_CLOSED = "channel is closed";
/** Refused because this install has no credential service to write through. */
export declare const COMMAND_NO_WRITES = "no credential service";
/** What the seam says about the key now, minus the seam itself: `seam` is a live object, not wire. */
export interface KeyReading {
    readonly present: boolean;
    readonly layer?: KeyLayer;
}
export interface CommandOutcome {
    /** True only when the command ran; a refusal says why in `reason` and writes nothing. */
    readonly ok: boolean;
    /** Why a command was refused. Undefined when ok: the honest text comes from the store. */
    readonly reason?: string;
    /**
     * What the seam says, re-read after the attempt. Absent when nothing was attempted.
     *
     * `KeyStatus` carries the seam object itself so in-process callers can chain another call on it.
     * That object would be a function-valued property on anything crossing to the page, so the
     * channel flattens it to the one bit the icon needs: is a key there now, and in which layer.
     */
    readonly status?: KeyReading;
    /** The store's own reply, refusals included (docs/02 section 1.2), already scrubbed. */
    readonly message?: string | null;
}
/**
 * Where the channel sends writes. Absent when the host has no credential service, which is a
 * state the page must be able to show rather than a reason to refuse activation.
 */
export interface ChannelWrites {
    readonly save: (key: string) => Promise<CommandOutcome>;
    readonly forget: () => Promise<CommandOutcome>;
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
    /**
     * The write half of the key seam, or nothing at all when this install has no credential service.
     *
     * Optional on purpose (T-2-e): a DSH without dsh-credentials-local still gets an icon, and its
     * command() answers "no service" instead of the plugin refusing to activate.
     */
    readonly writes?: ChannelWrites;
}
export interface ChannelHandle {
    /** Rebuild from current state, hand the result to every subscriber, and return it. */
    readonly publish: () => PublishedView;
    /** Re-send the last built view without reading the source again. */
    readonly republish: () => PublishedView;
    readonly isPublished: () => boolean;
    readonly command: (request: unknown) => Promise<CommandOutcome>;
    /** Attach the write half once the credential seam resolves. */
    readonly offer: (writes: ChannelWrites) => void;
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