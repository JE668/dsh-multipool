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
/** What a read-only source may answer, including "I have not looked yet". */
export interface SourceFacts {
    readonly accounts: readonly Account[] | undefined;
    readonly events: readonly MetricsEvent[] | undefined;
    readonly usage: Readonly<Partial<Record<ProviderId, UsageResult | null>>> | undefined;
    readonly activeSessions: number | undefined;
    readonly queued: number | undefined;
}
/** A source that has nothing to report yet: every member is absent, none is zero. */
export declare const NOTHING_READ: SourceFacts;
/**
 * The channel's shape, filled from facts that may be absent.
 *
 * Absent facts collapse to the smallest honest answer rather than the friendliest one: no accounts
 * reads as an empty list, because the snapshot type has no slot for "unknown list" and a count of
 * items you have not looked for is not a count. No usage reading stays out of the map entirely.
 */
export declare function channelSourceFrom(facts: SourceFacts, nowMs: () => number): ChannelSource;
//# sourceMappingURL=source.d.ts.map