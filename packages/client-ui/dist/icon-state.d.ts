/**
 * What the left sidebar icon shows, derived from the read-only snapshot (docs/05 section 2).
 *
 * This module is deliberately boring: no React, no DSH imports, no clock. The icon component
 * renders whatever comes out of here, and the fixtures assert on the same words the tooltip
 * shows, so a wrong count cannot hide behind a component that happens to look right.
 */
import type { AccountTally, ProviderId, ProviderSnapshot, Snapshot } from '@dsh-multipool/core';
/** Green: every enabled account is usable. Yellow: some are, some are cooling. Red: none are. Grey: nothing configured. */
export type IconLevel = 'green' | 'yellow' | 'red' | 'grey';
/** The five providers, in the order the tooltip lists them. */
export declare const ICON_PROVIDER_ORDER: readonly ProviderId[];
/** Display names for the tooltip. Kept short so three lines fit in a 56px rail. */
export declare const PROVIDER_SHORT_LABELS: Readonly<Record<ProviderId, string>>;
/** Marks a value the plugin has no upstream figure for fouled. An em dash, never a zero. */
export declare const NO_VALUE = "\u2014";
export interface IconCounts {
    readonly available: number;
    readonly total: number;
}
export interface ProviderCountLine {
    readonly providerId: ProviderId;
    readonly available: number;
    readonly total: number;
    /** False when the provider publishes no usage endpoint, so "0/0" would be a claim we cannot make. */
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
 */
export declare function iconLevelOf(overall: AccountTally, configured: boolean): IconLevel;
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
}): string;
/**
 * Line two when there is no host to ask.
 *
 * The budget is not zero -- zero is the number a configured pool with no roaming headroom
 * would print -- it is unknown. So the em dash stands in for the count, and the reason for the
 * dash is spelled out where line two usually prints its formula.
 */
export declare function rpmLineUnattached(): string;
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