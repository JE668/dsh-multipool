/**
 * What the left sidebar icon shows, derived from the read-only snapshot (docs/05 section 2).
 *
 * This module is deliberately boring: no React, no DSH imports, no clock. The icon component
 * renders whatever comes out of here, and the fixtures assert on the same words the tooltip
 * shows, so a wrong count cannot hide behind a component that happens to look right.
 */

import type { AccountTally, ProviderId, ProviderSnapshot, Snapshot } from '@dsh-multipool/core'

/** Green: every enabled account is usable. Yellow: some are, some are cooling. Red: none are. Grey: nothing configured. */
export type IconLevel = 'green' | 'yellow' | 'red' | 'grey'

/** The five providers, in the order the tooltip lists them. */
export const ICON_PROVIDER_ORDER: readonly ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

/** Display names for the tooltip. Kept short so three lines fit in a 56px rail. */
export const PROVIDER_SHORT_LABELS: Readonly<Record<ProviderId, string>> = {
  amd: 'AMD',
  nim: 'NIM',
  sensenova: 'SenseNova',
  agnes: 'Agnes',
  google: 'Google',
}

/** Marks a value the plugin has no upstream figure for fouled. An em dash, never a zero. */
export const NO_VALUE = '\u2014'

export interface IconCounts {
  readonly available: number
  readonly total: number
}

export interface ProviderCountLine {
  readonly providerId: ProviderId
  readonly available: number
  readonly total: number
  /** False when the provider publishes no usage endpoint, so "0/0" would be a claim we cannot make. */
  readonly hasEndpoint: boolean
}

function lineOf(provider: ProviderSnapshot): ProviderCountLine {
  return {
    providerId: provider.providerId,
    available: provider.tally.available,
    total: provider.tally.total,
    hasEndpoint: provider.usageAvailable || provider.dailyUsedPts !== undefined,
  }
}

/**
 * Level from the totals only, so it always agrees with the number on the badge.
 *
 * A pool with no keys is grey rather than red: red means "you asked for something and got
 * nothing", grey means "there is nothing to ask with yet". Painting an unconfigured install
 * red would be a claim about the upstream that we never made a request to support.
 */
export function iconLevelOf(overall: AccountTally, configured: boolean): IconLevel {
  if (!configured || overall.total === 0) return 'grey'
  if (overall.available === 0) return 'red'
  if (overall.available < overall.total) return 'yellow'
  return 'green'
}

/** The badge number: available accounts first, matching what the level means. */
export function badgeTextOf(counts: IconCounts): string {
  return String(counts.available) + '/' + String(counts.total)
}

/**
 * Line one: accounts, split by provider.
 *
 * A provider with no endpoint gets an em dash instead of "0/Actual", because both of its
 * numbers are about the plugin's configuration and reading a dash next to real fractions
 * is clearer than reading "0/0" and wondering which zero is the bad one.
 */
export function accountsLine(snapshot: Snapshot): string {
  const parts = ICON_PROVIDER_ORDER.map((providerId) => {
    const found = snapshot.providers.find((p) => p.providerId === providerId)
    if (found === undefined || found.tally.total === 0) return PROVIDER_SHORT_LABELS[providerId] + ' ' + NO_VALUE
    return PROVIDER_SHORT_LABELS[providerId] + ' ' + String(found.tally.available)
  })
  return '\u53ef\u7528\u8d26\u53f7 ' + String(snapshot.overall.available) + '/' + String(snapshot.overall.total)
    + '\uff08' + parts.join(' \u00b7 ') + '\uff09'
}

/**
 * Line two: the account-level rate the plugin lets itself use.
 *
 * The budget comes from computeBudget (docs/04 section 2.2), a formula over published limits
 * and two assumption factors -- not a measurement. The line prints the formula beside it so the
 * number is never read as something AMD said about this particular account.
 */
export function rpmLine(budget: { readonly admitRpm: number; readonly sources: readonly string[] }): string {
  const source = budget.sources[0]
  return '\u5168\u5c40 RPM ' + String(budget.admitRpm) + '\uff08' + (source === undefined ? NO_VALUE : source) + '\uff09'
}

/**
 * Line three: today's points, always as upstream reported them (docs/04 section 9.2).
 *
 * Takes a ProviderSnapshot rather than two numbers so there is no local estimate to pass in.
 * A provider that has never answered /v1/usage has no dailyLimitPts at all -- not zero of them --
 * and renders as a dash carrying the reason. A stale snapshot renders its values with the moment
 * they were read, so "4.19 left" and "4.19 left, as of 09:41" can never be confused.
 */
export function pointsLine(provider: ProviderSnapshot, fetchedAtLabel: string | null): string {
  const used = provider.dailyUsedPts?.value
  const limit = provider.dailyLimitPts?.value
  if (used === null || used === undefined || limit === null || limit === undefined) {
    // unknownValue is { value: null }, so a present-but-null field is still no reading at all.
    const reason = provider.usageUnavailableReason === undefined ? '无用量端点'
      : provider.usageUnavailableReason === 'no-endpoint' ? '无用量端点' : '上游未返回'
    return '今日 pts ' + NO_VALUE + '（' + reason + '）'
  }
  const base = '今日 pts ' + String(used) + ' / ' + String(limit)
  return fetchedAtLabel === null ? base : base + '（截至 ' + fetchedAtLabel + '）'
}

/** The three lines, in the order docs/05 section 2.3 fixes them. */
export interface IconLines {
  readonly accounts: string
  readonly rpm: string
  readonly points: string
}

export interface IconViewInput {
  readonly snapshot: Snapshot
  readonly budget: { readonly admitRpm: number; readonly sources: readonly string[] }
  /** The provider whose daily points line three reports, or null when none spoke yet. */
  readonly pointsProviderId: ProviderId | null
  /** When line three's numbers were fetched, if they are older than the snapshot itself. */
  readonly pointsFetchedAtLabel?: string | null
}

/** Everything the icon component needs, and nothing it would have to decide for itself. */
export interface IconView {
  readonly level: IconLevel
  readonly counts: IconCounts
  readonly badge: string
  readonly lines: IconLines
}

export function iconViewOf(input: IconViewInput): IconView {
  const snapshot = input.snapshot
  const counts = { available: snapshot.overall.available, total: snapshot.overall.total }
  const pointsProvider = input.pointsProviderId === null
    ? undefined
    : snapshot.providers.find((p) => p.providerId === input.pointsProviderId)
  const points = pointsProvider === undefined
    ? '\u4eca\u65e5 pts ' + NO_VALUE
    : pointsLine(pointsProvider, input.pointsFetchedAtLabel === undefined ? null : input.pointsFetchedAtLabel)
  return {
    level: iconLevelOf(snapshot.overall, snapshot.overall.configured),
    counts,
    badge: badgeTextOf(counts),
    lines: {
      accounts: accountsLine(snapshot),
      rpm: rpmLine(input.budget),
      points,
    },
  }
}
