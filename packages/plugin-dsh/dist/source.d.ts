/**
 * What the host half is allowed to say about itself, and what it is not (docs/05 section 2.3).
 *
 * The channel publishes whatever `ChannelSource` answers. Those answers come from somewhere, and
 * today that somewhere has no scheduler and no key store: `apply()` opens the channel with empty
 * lists, so the icon shows the same thing a fresh install shows. That is not a placeholder to be
 * filled with zeroes -- it is the honest report that nothing has been read yet.
 *
 * Two rules keep it honest as sources arrive:
 *
 * 1. A source that has not read anything answers `undefined`, never `0` and never `[]`-with-a-zero
 *    in it. `accounts` returning `[]` and `accounts` returning nothing yet are different claims:
 *    the first says "I asked, the pool is empty", the second says "I have not asked". Only the
 *    first may turn the icon grey, and only a real key store can make it.
 * 2. `usage` absent for a provider means "no reading", not "zero used". snapshot.ts already leaves
 *    the numbers off in that case, and this file must not manufacture the empty map that would
 *    smuggle a zero back in under another name.
 */
import type { Account, DashboardReading, MetricsEvent, ProviderId, UsageResult } from '@dsh-multipool/core';
import type { ChannelSource } from './channel.js';
import type { UsageAttempt } from './usage.js';
/** One press of the settings-page "account summary diagnosis" button (T-1-i).
 *
 * Read-only: it sends one minimal upstream request (max_tokens: 1) to read the account's own
 * rate-limit headers, prints what came back, and writes nothing -- not the key, not any budget
 * field, not the metrics store. The request is real traffic, so it counts against the account's
 * 20 RPM window like any other chat request; this plugin grants it no exemption.
 */
export interface DiagnoseResult {
    readonly providerId: ProviderId;
    /** X-RateLimit-Limit-User-RPM from the upstream, or null when the header was absent. */
    readonly upstreamLimit: number | null;
    /** X-RateLimit-Remaining-User-RPM from the upstream, or null when the header was absent. */
    readonly upstreamRemaining: number | null;
    readonly status: number | null;
    /** One sentence for the form -- never the key. */
    readonly said: string;
    /** Epoch ms this attempt finished, so a second press inside a minute can be refused locally. */
    readonly atMs: number;
    /** True when no request was made because the last one was too recent. */
    readonly tooSoon: boolean;
}
/** The two hooks apply() supplies once ctx.inject has resolved the services they need. */
export interface SourceHooks {
    readonly readFromSeam?: () => Promise<boolean>;
    readonly testUsage?: (providerId: ProviderId) => Promise<UsageAttempt>;
    /**
     * The live reading, or null when nobody is holding one right now (T-3-a).
     *
     * Facts are what the seam last said; this is what the upstream says when asked. They differ
     * in two ways that matter here: facts never age, and facts never carry a number the host did
     * not already owe somebody. The dashboard asks repeatedly, so it goes through this -- and so
     * it can only exist while a set of hooks is armed, which is why it lives on SourceHooks.
     */
    readonly readUsage?: (providerId: ProviderId) => Promise<UsageAttempt>;
    /**
     * The dashboard's own fold of the events store: one hour of minutes, plus the newest rows.
     *
     * Separate from readUsage() because it is a different kind of answer: readUsage() asks the
     * upstream or says why it could not, while this one can only ever report what was already
     * recorded. A page that drew them from one call would have no way to say "the last hour is
     * empty" without also implying the upstream agreed.
     */
    readonly readDashboard?: () => DashboardReading;
    /**
     * One account-summary diagnosis: send one minimal upstream request and report the
     * rate-limit headers it answered with (T-1-i).
     */
    readonly diagnose?: (providerId: ProviderId) => Promise<DiagnoseResult>;
}
/** What a read-only source may answer, including "I have not looked yet". */
export interface SourceFacts {
    readonly accounts: readonly Account[] | undefined;
    readonly events: readonly MetricsEvent[] | undefined;
    readonly usage: Readonly<Partial<Record<ProviderId, UsageResult | null>>> | undefined;
    readonly activeSessions: number | undefined;
    readonly queued: number | undefined;
    /**
     * The credential seam itself, when one is armed (T-2-f).
     *
     * Handed along so the page can ask it to make one request -- the usage read -- without the key
     * leaving the process that already holds it. Absent on an install with no provider, which is the
     * same absence the icon paints.
     */
    readonly seam?: unknown;
    /**
     * Which layer answered when the key was last read, or absent when nobody has read it.
     *
     * It sits beside `accounts` rather than inside them because it is a fact about the seam, not
     * about the accounts: `accountFrom()` will not put a layer on an Account, and a settings page that
     * wanted one would have to be handed it anyway. Absent when nobody looked, so a page can say "no
     * one has read" instead of "the file", which it would merely be guessing.
     */
    readonly keyLayer: string | undefined;
    /**
     * Step 2 gate toggle: the settings section flips this, and the intercept layer reads it
     * on every AMD request. Absent means "off" (read-only).
     */
    readonly rejectOnBudgetExhausted?: boolean;
    /**
     * Step 3C gate toggle: the settings section flips this, and the panel reads it to decide
     * whether to open the shell immersion overlay instead of the drawer-only panel. Absent means off.
     */
    readonly dashboardMode?: boolean;
}
/** A source that has nothing to report yet: every member is absent, none is zero. */
export declare const NOTHING_READ: SourceFacts;
/**
 * The channel's shape, filled from facts that may be absent.
 *
 * Absent facts collapse to the smallest honest answer rather than the friendliest one: no accounts
 * reads as an empty list, because the snapshot type has no slot for "unknown list" and a count of
 * items you have not looked for is not a count. No usage reading stays out of the map entirely.
 *
 * `reading` is the exception, and it is why the sentence above is only half true: `accounts ?? []`
 * gives snapshot.ts a list it can count, and a count is a number, so an unread pool arrives at the
 * badge as 0/0 -- the same glyph as a pool that was read and found empty. The third answer has to be
 * carried alongside the list, not deduced from it.
 */
export declare function channelSourceFrom(facts: SourceFacts, nowMs: () => number, hooks?: SourceHooks): ChannelSource;
/**
 * Which layer last answered, or nothing at all when nobody has asked yet.
 *
 * The name travels as the seam spelled it -- this module does not keep a list of layers it approves
 * of. A seam that answers some fifth word is answering a question this file never asked it, and
 * whether the page has a sentence for that word is the page's vocabulary to hold (client.js,
 * layerWord). Spelling the four out here would put the same decision in two places, and the copy
 * that runs first would win: the seam's new layer would reach the page as "no one has read",
 * which is a lie with a question mark in it.
 *
 * Absent only when nobody has asked, which is the absence the page is allowed to describe.
 */
export declare function keyLayerOf(facts: SourceFacts): string | undefined;
/**
 * Whether the facts in hand came from a read, from a pool that was read and empty, or from neither.
 *
 * `unread` is the third answer, and it is the one this repo kept losing: accounts.ts and source.ts
 * both turn "no one has looked" into an empty list, and an empty list is a perfectly good number --
 * zero -- for everything downstream. U-06 forbids that zero, so the state has to travel as its own
 * word the whole way to the badge, where it prints a dash instead of a digit.
 */
export type Reading = 'unread' | 'read' | 'empty';
/** Unread when the list is absent; empty or read when it was handed over, judged by its size. */
export declare function readingOf(facts: SourceFacts): Reading;
//# sourceMappingURL=source.d.ts.map