/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page over two `window` events agreed on below, not over a window key.
 *
 * Two earlier designs were tried and both failed in the same place. A key failed because the two
 * halves are two processes unrestrained by anything but hope: the host wrote, the page read
 * nothing, and every test passed because a test hands both halves one global. `connection.rpc`
 * (dsh-client-connection) then failed because the browser half provides that service only inside
 * DSH's own client bundle, not to a plugin loaded from a profile -- no `connection` on the page,
 * `ctx.inject(['connection'], ...)` never called back, and the icon drew dashes while the host it
 * could not reach was running fine.
 *
 * What is left is the window both halves demonstrably share in DSH desktop, which is the
 * renderer's. The cost is stated here rather than discovered later: a window event carries no
 * authentication, so this is a same-process conversation, and any script already running on the
 * page could answer in the host's place. Nothing in this file claims otherwise (docs/09).
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
 *
 * One property is easy to lose here and was lost once already. Both endpoints return JSON, so
 * nothing on the wire may be a function or a live handle -- which is why CommandOutcome carries a
 * KeyReading and not the KeyStatus it was built from. A test that shares the same process cannot
 * notice the difference, so the shape is narrow on purpose.
 */
import { type Account, type MetricsEvent, type ProviderId, type Snapshot, type UsageResult } from '@dsh-multipool/core';
import { type IconView } from '@dsh-multipool/plugin-client';
import type { KeyLayer } from './key-store.js';
/**
 * The two window events the halves talk over.
 *
 * `page` is what the page dispatches and the host listens for; `host` is the answer, and it names
 * the side that sends it rather than the side that receives it, so neither name has to be read
 * from the other's point of view. Both are namespaced under `dsh-multipool:` because a window
 * event bus is shared with every other plugin in the profile, and an unprefixed name is a
 * collision waiting for the second plugin to be written.
 *
 * The payload rule is the same one the view itself follows (docs/03): what travels is JSON, never
 * a function, a class instance, or a live handle. Each event names its endpoint (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one
 * more branch in dispatch(), not a second event pair to keep in sync.
 */
export declare const BRIDGE_EVENT = "dsh-multipool:bridge";
export declare const BRIDGE_REPLY = "dsh-multipool:bridge-reply";
/**
 * The endpoint names the page may ask for over BRIDGE_EVENT.
 *
 * These used to be RPC endpoint names under CHANNEL = '/multipool'. They keep their spelling so the
 * two halves of this repo still speak one vocabulary, and they are now the only part of the
 * request the host trusts before it has looked at the payload.
 */
export declare const ENDPOINT_SNAPSHOT = "snapshot";
export declare const ENDPOINT_COMMAND = "command";
/**
 * What the browser half asks for. The page dispatches BRIDGE_EVENT with one of these and listens on
 * BRIDGE_REPLY for the matching callId.
 */
export interface Channel {
    /** ENDPOINT_SNAPSHOT: the current view, as it stands, JSON on the wire. */
    readonly view: () => IconView;
    /**
     * ENDPOINT_COMMAND: ask the host to do one named thing.
     *
     * Its argument is `unknown` because the page is the one place a command arrives without having
     * been typed: a name this file has never heard of is a refusal, never a TypeError thrown into
     * the caller's click handler. The payload has crossed JSON by the time it gets here, so the
     * first thing dispatch() does is stop trusting its shape.
     */
    readonly command: (request: unknown) => Promise<CommandOutcome>;
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
    /** Rebuild from current state and remember it. Returns what the next view() will answer. */
    readonly publish: () => PublishedView;
    readonly isPublished: () => boolean;
    readonly command: (request: unknown) => Promise<CommandOutcome>;
    /** Attach the write half once the credential seam resolves. */
    readonly offer: (writes: ChannelWrites) => void;
    /** Forget the last view. The channel is dead afterwards. */
    readonly close: () => void;
}
export declare function buildPublishedView(source: ChannelSource, budget: IconBudget, pointsProviderId: ProviderId | null): PublishedView;
/**
 * Opens the channel and returns the handle.
 *
 * Nothing is installed on the page here: `apply` closes over the handle and registers it with
 * `connection.rpc.handle`, which is the thing that admits a caller. This function only decides
 * what the two endpoints answer.
 */
export declare function openChannel(options: OpenChannelOptions): ChannelHandle;
/** The shape BRIDGE_REPLY sends back: the endpoint's answer, plus which call it answers. */
export interface BridgeReply {
    readonly callId: string;
    readonly ok: boolean;
    readonly value?: unknown;
    readonly error?: {
        readonly code: string;
        readonly message: string;
    };
}
/** One bridge call answered, before it is given a callId. The same envelope as BridgeReply. */
export type BridgeAnswer = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
    };
};
/**
 * A minimal window: one listener to add, one event to dispatch-back, and nothing else.
 *
 * Written out instead of taking the DOM's Window so a test can hand over a plain object and the
 * host half never needs a browser to typecheck. In DSH the real value is `globalThis`.
 */
export interface BridgeTarget {
    addEventListener(type: string, listener: (event: unknown) => void): unknown;
    removeEventListener(type: string, listener: (event: unknown) => void): unknown;
    dispatchEvent(event: {
        readonly type: string;
        readonly detail?: unknown;
    }): unknown;
}
/**
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of the event. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a
 * class instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
 *
 * An unknown endpoint is refused by name. Rule 3 one level up: the set of endpoints is the whole
 * surface a page can reach, so it stays a list somebody reads.
 */
export declare function answerOf(handle: ChannelHandle): (endpoint: string, payload: unknown) => Promise<BridgeAnswer>;
/** What a bridge request says, once its shape has been checked and nothing has been assumed. */
export interface BridgeRequest {
    readonly callId: string;
    readonly endpoint: string;
    readonly payload: unknown;
}
/**
 * Reads one BRIDGE_EVENT detail, or nothing when this event is not ours.
 *
 * Kept apart from the listener so a test can hand it a plain object and never touch a window. A
 * detail with no string callId or no string endpoint is not a malformed request to refuse -- it is
 * somebody else's event, or a stray dispatch with no fields, and the ordinary answer to both is to
 * not answer.
 */
export declare function readBridgeRequest(detail: unknown): BridgeRequest | undefined;
/**
 * Wires BRIDGE_EVENT on `target` to `handle`, and sends each answer back on BRIDGE_REPLY.
 *
 * The two events are how the halves reach each other now. The page dispatches one; this process
 * listens, answers, and dispatches the other with the caller's own callId, so two requests in
 * flight cannot swap answers. `target` is `globalThis` in DSH, where host and page are the same
 * Electron renderer -- which is also the whole reason there is no authentication here (docs/09).
 *
 * The returned disposer removes the listener, and is what makes a disable leave nothing behind on
 * the bus: the same promise route registration made, now checkable without a web server.
 */
export declare function bridgeOf(handle: ChannelHandle, target?: BridgeTarget | undefined): () => void;
//# sourceMappingURL=channel.d.ts.map