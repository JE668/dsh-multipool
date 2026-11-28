/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page as an HTTP route under CHANNEL, served by this process's web server.
 *
 * Three earlier designs were tried and all three failed in the same place: each assumed the two
 * halves share something that an application process can only be lent. A window key assumed one
 * global. `connection.rpc` assumed a service the browser half receives, and DSH provides that one
 * only inside its own client bundle, not to a plugin a profile loads. Window events assumed one
 * window -- and dispatchEvent did fire on the renderer's, into a bus this Node process was never
 * subscribed to, so the page reported "6 dispatch returned ; no reply in 4000ms".
 *
 * An HTTP route assumes neither. The page asks for it the way DSH desktop's own shell asks for
 * everything: dsh-app://app/<path> is handed by protocol.handle to forwardWebRequest, which
 * reissues the request against this web server with the Host's own cookie attached, and only for
 * the main frame's origin. The authentication is that cookie, checked by ctx.connection.admit
 * before the route is reached, so this file authenticates nothing and stores nothing -- the same
 * promise credentials.ts makes in its first rule. What it does not get is a push channel: a page
 * asks, and the answer stands until the page asks again.
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
import type { UsageAttempt } from './usage.js';
/**
 * The path prefix the page asks under, and the two endpoints below it.
 *
 * One segment, no dots and no blanks, because it is also what the renderer spells in a URL and what
 * a second plugin would have to avoid picking. The web server refuses a duplicate prefix outright,
 * so the collision this name could cause is a startup error with a message, not a request answered
 * by the wrong plugin.
 *
 * The payload rule is the one the view itself follows (docs/03): what travels is JSON, never a
 * function, a class instance, or a live handle. Each endpoint names itself in the path (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one more
 * branch in answerOf(), not a second event pair to keep in sync.
 */
export declare const CHANNEL = "/dsh-multipool";
/**
 * How far `accounts()` has been read, in the only three words that are true.
 *
 * `empty` is a reading and `unread` is not: the first says the pool was asked and holds nothing, the
 * second says nobody has asked. Only the first may print a number at all, and it prints zero.
 */
export type Reading = 'unread' | 'read' | 'empty';
/**
 * The endpoint names the page may ask for, one path segment under CHANNEL.
 *
 * These have kept their spelling across four transports, so the two halves of this repo still speak
 * one vocabulary; and they are the only part of the request the host trusts before it has looked at
 * the payload.
 */
export declare const ENDPOINT_SNAPSHOT = "snapshot";
export declare const ENDPOINT_COMMAND = "command";
/**
 * Not an endpoint this repo's own page calls: the third is where a *prompt* would go, so the name is
 * taken here to mean "ask the upstream once, on purpose" and documented as such.
 */
export declare const ENDPOINT_TEST = "test";
/**
 * T-3-a's dashboard reading, as opposed to T-2-f's pressed one.
 *
 * The same question asked by a timer instead of a person, so it gets its own name: a dashboard
 * that re-renders every few seconds must not be able to look like someone pressed Test, and a
 * press must not be told a poll is waiting. Both go through sources.readUsage and both sit under
 * the same sixty-second floor, because that floor belongs to the upstream, not to the surface
 * that happened to notice it.
 */
export declare const ENDPOINT_READING = "reading";
/**
 * Field carrying which provider the test is about. Absent means the one the icon prints numbers for,
 * which today is the only provider with a usage endpoint.
 */
export declare const TEST_PROVIDER = "providerId";
/**
 * Refused because this host was built without anything that can reach an upstream.
 *
 * Two codes, not one, because one sentence had been standing in for two different bugs: the page
 * was asking nobody (no ChannelSource reached answerOf, or it had no testUsage), and the page was
 * asking somebody who had no credential service to lend. The first is a wiring bug, the second is a
 * DSH build that provides no credentials -- and until they were separated, both printed identical words.
 */
export declare const NO_TEST_SOURCE = "multipool/no-upstream";
/** Refused because the source exists and is wired, but it holds no seam to spend. */
export declare const NO_TEST_SEAM = "multipool/no-credential-seam";
/**
 * What the browser half asks for. A page POSTs to CHANNEL/<endpoint> and reads the answer as JSON.
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
    /**
     * Whether `accounts()` is a reading at all, or only the list this source happens to hold.
     *
     * The two are indistinguishable by shape: an unread pool and a pool that was read and found empty
     * both answer `[]`, and the badge draws `0/0` for both. The first is not a claim the host may make
     * (U-06), so the difference travels as a third word rather than as a convention every painter has
     * to remember.
     */
    readonly reading: () => Reading;
    /**
     * Which layer answered the key read, or nothing when nobody has read it yet.
     *
     * The settings page's one non-numeric line depends on this: "stored" alone is true of every
     * install and tells a reader nothing about whether their `.env` or their Keychain is what
     * answered. It rides beside `reading` for the same reason -- both are facts about the seam that
     * the accounts list cannot carry.
     */
    readonly keyLayer?: () => string | undefined;
    /**
     * The upstream usage reading for this provider, asked for now (T-2-f's test button).
     *
     * Absent when nobody can ask: no seam, or a seam that only describes. One call puts at most one
     * request on the wire and charges at most that request's zero points; `tooSoon` says the call was
     * not even made because the last one was under the floor.
     */
    readonly testUsage?: (providerId: ProviderId) => Promise<UsageAttempt>;
    /**
     * Ask the seam for the key now, and write what it says into these facts.
     *
     * Absent when the hook was never wired. Present, it is the only way the page can make the host
     * look: the alternative was a read on apply(), which paints a fresh install's icon with a
     * conclusion nobody asked for.
     */
    readonly readFromSeam?: () => Promise<boolean>;
    /**
     * The same reading as testUsage, asked by a timer rather than a hand (T-3-a).
     *
     * A separate name because the two callers are separate promises: a poll inside the minute gets
     * the carried reading back (tooSoon false, carried true) rather than a refusal, so a dashboard
     * always has the last number it saw to draw. No new request, no new cost -- usage.ts decides that.
     */
    readonly readUsage?: (providerId: ProviderId) => Promise<UsageAttempt>;
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
    readonly layer?: string;
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
    /** How far the accounts were read: 'unread' is not the same claim as 'empty'. */
    readonly reading: Reading;
    readonly view: IconView;
    /** The scrubbed JSON. Kept beside the view so a test can assert the wire carries no key. */
    readonly wire: string;
    /** Which layer answered, absent when nobody has read the seam. Same reason as ChannelSource. */
    readonly layer?: string;
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
    /**
     * The last published view, or null before the first publish.
     *
     * answerOf() asks through this so the page's snapshot request does not double as a command: a
     * question must not refresh the state the rest of the file is answering from.
     */
    readonly published: () => PublishedView | null;
    readonly isPublished: () => boolean;
    readonly command: (request: unknown) => Promise<CommandOutcome>;
    /**
     * The source this handle was opened over, handed back so the route can be wired with it.
     *
     * It travels here rather than being passed alongside `openChannel({ source })` because the two
     * used to be separate arguments at separate call sites, and the second one was forgotten: the
     * route was registered without a source, so the test endpoint refused every press with "this host
     * cannot ask an upstream" while the host was in fact asking one every five seconds for the icon.
     * One object, one path -- the route takes the handle and reads the source off it.
     */
    readonly source: ChannelSource;
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
/**
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of a request body. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a class
 * instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
 *
 * An unknown endpoint is refused by name. Rule 3 one level up: the set of endpoints is the whole
 * surface a page can reach, so it stays a list somebody reads.
 */
export declare function answerOf(handle: ChannelHandle, source?: ChannelSource): (endpoint: string, payload: unknown) => Promise<BridgeAnswer>;
/** One endpoint answered, before it is given a status. The envelope answerOf returns. */
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
 * The part of a Node http request this route reads.
 *
 * Structural rather than node:http's IncomingMessage: the web server passes real ones, a test
 * passes four lines, and this file then never depends on a transport's types to say what it uses.
 */
export interface BridgeRequest {
    readonly method?: string | undefined;
    readonly url?: string | undefined;
    [Symbol.asyncIterator](): AsyncIterator<unknown>;
}
/** The part of a Node http response this route writes. */
export interface BridgeResponse {
    writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown;
    end(body?: string): unknown;
}
/** A Route's handler takes Node's request and response, which is the read and the write above. */
export interface Route {
    readonly kind: 'prefix';
    readonly path: string;
    readonly handler: (req: BridgeRequest, res: BridgeResponse) => unknown;
}
/** What a web server has to offer to be claimable here: one prefix, and that claim back. */
export interface RouteServer {
    register(route: Route): () => void;
}
/**
 * The web route: POSTs to the two endpoints, JSON in and JSON out.
 *
 * Only POST is answered. A GET is told the method exists and is elsewhere (Allow), rather than being
 * handed a snapshot a link could have prefetched or a cache could have kept: both endpoints speak
 * about this moment in the pool, and this moment has no address. The route is one prefix rather than
 * two exact entries so a third endpoint is a string in this file and a branch in answerOf(), not a
 * second registration somebody has to keep in step with the first.
 *
 * Nothing is read from the cookie here and nothing is set on it. `ctx.connection.admit` has already
 * decided whether the caller reaches a route at all, before this handler is called.
 */
export declare function routeOf(handle: ChannelHandle, source?: ChannelSource): Route;
/**
 * Claims the route and returns the disposer, or a disposer with nothing claimed.
 *
 * No web server means no route and nothing thrown: the same shape bridgeOf took for a missing window.
 * apply() has to return a disposer either way, and an entry that throws is an entry DSH removes from
 * the page with only a console line left behind (docs/09 section 6.1).
 */
export declare function serveOn(server: RouteServer | undefined, handle: ChannelHandle, source?: ChannelSource): () => void;
//# sourceMappingURL=channel.d.ts.map