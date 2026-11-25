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
import type { Account, MetricsEvent, ProviderId, UsageResult } from '@dsh-multipool/core';
import type { ChannelSource } from './channel.js';
import type { KeyLayer } from './key-store.js';
import type { UsageAttempt } from './usage.js';
/** The two hooks apply() supplies once ctx.inject has resolved the services they need. */
export interface SourceHooks {
    readonly readFromSeam?: () => Promise<boolean>;
    readonly testUsage?: (providerId: ProviderId) => Promise<UsageAttempt>;
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
    readonly keyLayer: KeyLayer | undefined;
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
 * Not `facts.keyLayer ?? 'file'`: key-store.ts already draws that line for a *configured* key with
 * no named source, where "the value is there and saying where would be a guess" still deserves the
 * word that describes the common case. Here the question has not been put, so the only honest answer
 * is the absence -- and the page prints "no one has read" rather than naming a layer nobody reported.
 */
export declare function keyLayerOf(facts: SourceFacts): KeyLayer | undefined;
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