/**
 * What the left sidebar icon shows, derived from the read-only snapshot (docs/05 section 2).
 *
 * This module is deliberately boring: no React, no DSH imports, no clock. The icon component
 * renders whatever comes out of here, and the fixtures assert on the same words the tooltip
 * shows, so a wrong count cannot hide behind a component that happens to look right.
 */
import type { AccountTally, ProviderId, ProviderSnapshot, Snapshot } from '@dsh-multipool/core';
/**
 * Green: every enabled account is usable. Yellow: some are, some are cooling. Red: none are.
 * Grey: nothing configured. Idle: this drawer has not heard from the host at all.
 *
 * idle is deliberately separate from grey -- see iconLevelOf.
 */
export type IconLevel = 'green' | 'yellow' | 'red' | 'grey' | 'idle';
/** The five providers, in the order the tooltip lists them. */
export declare const ICON_PROVIDER_ORDER: readonly ProviderId[];
/** Display names for the tooltip. Kept short so three lines fit in a 56px rail. */
export declare const PROVIDER_SHORT_LABELS: Readonly<Record<ProviderId, string>>;
/** Marks a value the plugin has no upstream figure for. An em dash, never a zero. */
export declare const NO_VALUE = "\u2014";
/**
 * How far the host half has read the pool, carried beside the counts (source.ts Reading).
 *
 * `empty` is a reading and `unread` is not. A host that asked and found no keys has an answer
 * worth printing, and it is '0/0'. A host that has not answered yet has no answer, and 0/0 is
 * the one glyph docs/05 section 2.3 keeps it from -- so it prints the dash pair and stays idle.
 */
export type Reading = 'unread' | 'read' | 'empty';
/** Line two's reason when the host half never answered at all. */
export declare function hostUnreachable(): string;
/** Line one's answer when the host answered but nobody has looked yet. */
export declare function accountsUnread(): string;
/** Line two's reason when the host is running but has not looked at the pool yet. */
export declare function notReadYet(): string;
/** Line two's count when no count was ever taken. */
export declare function rpmUnread(): string;
export interface IconCounts {
    readonly available: number;
    readonly total: number;
    /** How far the host got. Absent when nobody said, which is unread -- never zero. */
    readonly reading?: Reading;
}
export interface ProviderCountLine {
    readonly providerId: ProviderId;
    readonly available: number;
    readonly total: number;
    /**
     * False when the provider publishes no usage endpoint, so "0/0" would be a claim we cannot make.
     *
     * Read from `usageAvailable` alone: the field being present is not the endpoint existing. A
     * present-but-null figure is what `unknownValue()` writes when upstream never said, and counting it
     * as an endpoint turns "no answer" into "answered nothing", which is the one lie docs/05 section
     * 2.3 keeps line three from telling. Presence of the field is checked only after upstream has spoken.
     */
    readonly hasEndpoint: boolean;
    /** True when that endpoint answered with actual numbers -- a field present but null is not a reading. */
    readonly hasReading: boolean;
}
/**
 * Level from the totals only, so it always agrees with the number on the badge.
 *
 * A pool with no keys is grey rather than red: red means "you asked for something and got
 * nothing", grey means "there is nothing to ask with yet". Painting an unconfigured install
 * red would be a claim about the upstream that we never made a request to support.
 *
 * `attached` splits the other half of the same question. Grey is a verdict: the host answered,
 * and the answer was "no keys". A drawer that never heard from the host has reached no verdict
 * at all, so it is idle, not grey. Merging the two would make "the plugin is switched off" and
 * "you have not set a key yet" the same picture, which is the one thing a status light must
 * never do.
 */
export declare function iconLevelOf(overall: AccountTally, configured: boolean, attached?: boolean, reading?: Reading): IconLevel;
/** The badge number: available accounts first, matching what the level means. */
export declare function badgeTextOf(counts: IconCounts): string;
/**
 * The badge for a view that may not have reached the host yet.
 *
 * "0/0" is a readable claim -- an empty pool -- and a running host with no keys really would
 * mean it. A host that has not answered has made no claim at all, so it shows a pair of dashes
 * instead. The two cases must not share a glyph.
 */
export declare function badgeFor(view: {
    readonly attached: boolean;
    readonly badge: string;
    readonly reading?: Reading;
}): string;
/**
 * Line two when there is no host to ask.
 *
 * The budget is not zero -- zero is the number a configured pool with no roaming headroom
 * would print -- it is unknown. So the em dash stands in for the count, and the reason for the
 * dash is spelled out where line two usually prints its formula.
 */
export declare function rpmLineUnattached(reason?: string): string;
/**
 * Line one: accounts, split by provider.
 *
 * A provider with no endpoint gets an em dash instead of "0/Actual", because both of its
 * numbers are about the plugin's configuration and reading a dash next to real fractions
 * is clearer than reading "0/0" and wondering which zero is the bad one.
 */
export declare function accountsLine(snapshot: Snapshot): string;
/**
 * Line two: the account-level rate the plugin lets itself use.
 *
 * The budget comes from computeBudget (docs/04 section 2.2), a formula over published limits
 * and two assumption factors -- not a measurement. The line prints the formula beside it so the
 * number is never read as something AMD said about this particular account.
 */
export declare function rpmLine(budget: {
    readonly admitRpm: number;
    readonly sources: readonly string[];
}): string;
/**
 * Line three: today's points, always as upstream reported them (docs/04 section 9.2).
 *
 * Takes a ProviderSnapshot rather than two numbers so there is no local estimate to pass in.
 * A provider that has never answered /v1/usage has no dailyLimitPts at all -- not zero of them --
 * and renders as a dash carrying the reason. A stale snapshot renders its values with the moment
 * they were read, so "4.19 left" and "4.19 left, as of 09:41" can never be confused.
 */
export declare function pointsLine(provider: ProviderSnapshot, fetchedAtLabel: string | null): string;
/** The three lines, in the order docs/05 section 2.3 fixes them. */
export interface IconLines {
    readonly accounts: string;
    readonly rpm: string;
    readonly points: string;
}
export interface IconViewInput {
    readonly snapshot: Snapshot;
    /**
     * Whether the host half is reachable and has published a snapshot.
     *
     * Without this the drawer cannot tell "no keys configured" from "nothing is running", and
     * paints both as the same grey 0/0 -- a claim about the user's setup that it never checked.
     * Defaults to true so a caller that did reach the host does not have to say so twice.
     */
    readonly attached?: boolean;
    readonly budget: {
        readonly admitRpm: number;
        readonly sources: readonly string[];
    };
    /** The provider whose daily points line three reports, or null when none spoke yet. */
    readonly pointsProviderId: ProviderId | null;
    /** When line three's numbers were fetched, if they are older than the snapshot itself. */
    readonly pointsFetchedAtLabel?: string | null;
    /**
     * How far the host got: 'unread' when it never looked, 'empty' when it looked and found none.
     *
     * Absent is read as unread rather than as zero, because a caller that did not say is a caller
     * whose pool was never counted, and 0/0 is a number.
     */
    readonly reading?: Reading;
}
/** Everything the icon component needs, and nothing it would have to decide for itself. */
export interface IconView {
    readonly level: IconLevel;
    readonly counts: IconCounts;
    readonly badge: string;
    readonly lines: IconLines;
    /** False when this view is the placeholder the drawer paints before any host half is heard from. */
    readonly attached: boolean;
}
export declare function iconViewOf(input: IconViewInput): IconView;
//# sourceMappingURL=icon-state.d.ts.map