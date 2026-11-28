/**
 * Host -> Client read-only snapshot (06 T-2-a, docs/05 sections  Lois 2 and 3).
 *
 * The client half of the plugin cannot reach the host's key store, the account gate
 * or the metrics store. It gets one plain JSON object per refresh and renders it.
 * That object is built here, in core, so that the one rule that matters -- nothing
 * leaves the host with a whole key in it -- is enforced in one place and tested
 * with a unit test rather than trusted to every caller.
 *
 * Every number carries its Sourced provenance through unchanged (docs/00 rule 2).
 * This layer aggregates and stamps; it never invents a value to fill a gap, and
 * it never turns "no endpoint" into 0.
 */
import { scrubSecrets } from './secret.js';
/** The five providers in display order. emptySnapshot needs the list even when nobody is configured. */
export const PROVIDER_ORDER = ['amd', 'nim', 'sensenova', 'agnes', 'google'];
/** Placeholder for ProviderTally.providerId on the whole-pool aggregate; not a real provider. */
export const ALL_PROVIDERS = 'all';
const RATE_WINDOW_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
function windowRate(events, nowMs) {
    const since = nowMs - RATE_WINDOW_MS;
    let requests = 0;
    let err429 = 0;
    for (const event of events) {
        if (event.ts < since)
            continue;
        requests += 1;
        if (event.status === 429)
            err429 += 1;
    }
    if (requests === 0)
        return { requests, err429, rate: null };
    const pct = (err429 / requests) * 100;
    return {
        requests,
        err429,
        rate: { value: pct.toFixed(2), source: 'assume', ref: 'local counters, ' + String(RATE_WINDOW_MS) + 'ms window' },
    };
}
/** Available is the one status that counts: a cooling or unknown-quota account is not usable now. */
function accountIsUsable(status) {
    return status === 'available';
}
function tallyOf(accounts) {
    let available = 0;
    let total = 0;
    for (const account of accounts) {
        total += 1;
        if (account.enabled && accountIsUsable(account.status))
            available += 1;
    }
    return { available, total };
}
/**
 * Projects an account for the wire. The secret is not a field of Account, but the
 * record arriving here is structurally wider; listing the fields we keep means a
 * future field cannot leak by default. scrubSecrets is belt and braces.
 */
export function toClientAccount(account) {
    const out = {
        providerId: account.providerId,
        accountAlias: scrubSecrets(String(account.accountAlias)),
        keyIdMasked: scrubSecrets(String(account.keyIdMasked)),
        enabled: account.enabled === true,
        status: account.status,
        ...(account.coolUntil === undefined ? {} : { coolUntil: account.coolUntil }),
        ...(account.cooldownReason === undefined ? {} : { cooldownReason: account.cooldownReason }),
    };
    return out;
}
/**
 * Per-provider card data for docs/05 section 3.2. Absent usage stays absent: the caller
 * checks `usageAvailable` and renders "no endpoint" rather than a zero.
 */
export function providerSnapshotOf(providerId, accounts, events, nowMs, usage) {
    const mine = accounts.filter((account) => account.providerId === providerId);
    const hourFloor = nowMs - HOUR_MS;
    const byKind = {};
    let err429LastHour = 0;
    for (const event of events) {
        if (event.providerId !== providerId)
            continue;
        if (event.status !== 429)
            continue;
        if (event.ts < hourFloor)
            continue;
        err429LastHour += 1;
        if (event.rateKind !== undefined) {
            byKind[event.rateKind] = (byKind[event.rateKind] ?? 0) + 1;
        }
    }
    const usageAvailable = usage !== null && usage !== undefined && usage.available === true;
    return {
        providerId,
        tally: tallyOf(mine),
        ...(usage?.rpmLimit === undefined ? {} : { rpmLimit: usage.rpmLimit }),
        ...(usage?.dailyUsedPts === undefined ? {} : { dailyUsedPts: usage.dailyUsedPts }),
        ...(usage?.dailyLimitPts === undefined ? {} : { dailyLimitPts: usage.dailyLimitPts }),
        ...(usage?.dailyResetAt === undefined ? {} : { dailyResetAt: usage.dailyResetAt }),
        ...(usage?.fetchedAt === undefined ? {} : { usageFetchedAt: usage.fetchedAt }),
        usageAvailable,
        ...(usageAvailable ? { usageSource: 'api' } : {}),
        ...(usage?.reason === undefined ? {} : { usageUnavailableReason: usage.reason }),
        err429LastHour,
        err429ByKind: byKind,
    };
}
/**
 * Builds the whole payload. The event list is passed through only as aggregates --
 * requests, 429s marked by rate kind, and the cooling accounts -- so raw requests do not
 * travel to the client just to be counted there. That is what keeps D-02 honest on the
 * wire and not merely on disk.
 */
export function buildSnapshot(input, providers) {
    const accounts = input.accounts.map(toClientAccount);
    const cooling = [];
    for (const account of accounts) {
        if (account.coolUntil === undefined || account.coolUntil <= input.nowMs)
            continue;
        cooling.push({
            providerId: account.providerId,
            accountAlias: account.accountAlias,
            rateKind: account.cooldownReason ?? 'rate_opaque',
            untilMs: account.coolUntil,
        });
    }
    cooling.sort((a, b) => a.untilMs - b.untilMs);
    const perProvider = providers.map((providerId) => providerSnapshotOf(providerId, accounts, input.events, input.nowMs, input.usage?.[providerId]));
    const overallTally = tallyOf(accounts);
    const overall = { ...overallTally, providerId: ALL_PROVIDERS, configured: accounts.length > 0 };
    return {
        generatedAtMs: input.nowMs,
        accounts,
        providers: perProvider,
        overall,
        cooling,
        last5m: windowRate(input.events, input.nowMs),
        counters: { activeSessions: input.activeSessions, queued: input.queued },
    };
}
/**
 * An empty pool: no accounts, no events, no usage.
 *
 * This is the snapshot an install has before the host has said anything -- the browser half
 * may mount before the wire is attached, or the host may be shut down. It is deliberately
 * built through the same code path as a live pool so it cannot drift into "0 available" or
 * "null total" by accident; every provider comes back configured:false.
 */
export function emptySnapshot() {
    return buildSnapshot({ accounts: [], events: [], nowMs: 0, activeSessions: 0, queued: 0 }, PROVIDER_ORDER);
}
/** JSON form handed to the client plugin. Same bytes, one place to call scrubSecrets. */
export function serializeSnapshot(snapshot) {
    return scrubSecrets(JSON.stringify(snapshot));
}
/** Types the untrusted client-facing shape back into Sourced<number>, refusing the rest. */
export function sourcedNumberFromWire(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const record = value;
    if (typeof record['value'] !== 'number' || !Number.isFinite(record['value']))
        return null;
    if (typeof record['source'] !== 'string')
        return null;
    return { value: record['value'], source: record['source'] };
}
//# sourceMappingURL=snapshot.js.map