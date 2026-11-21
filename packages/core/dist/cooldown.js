/**
 * What a classified AMD response does to the account that produced it.
 *
 * classifyAmd() returns a RateClass, an Account carries a cooldownReason, and in this repo
 * until now nothing turned the first into the second outside a test's hand-written fixture.
 * The type check could not notice: a fixture that writes cooldownReason: 'rpm_key' by hand
 * proves the snapshot reads the field, not that anything ever fills it.
 *
 * This module is that one row. It is pure -- no clock, no storage, no scheduling -- so the
 * batch can fix the mapping without pretending the scheduler is wired.
 */
/** Status an account wears while it is cooling for one rate class. */
const STATUS_WHILE_COOLING = {
    rpm_key: 'rate_limited',
    rpm_ip: 'rate_limited',
    concurrency: 'rate_limited',
    daily_quota: 'quota_exhausted',
    plan_credit: 'quota_exhausted',
    auth: 'auth_failed',
    // The model itself is gone, not the account's turn: cooling it would be a wrong excuse.
    model_missing: 'available',
    // The body did not say which limiter fired, so the account keeps saying it does not know.
    rate_opaque: 'quota_unknown',
};
/**
 * The account as it stands after one verdict, or the same account when the verdict leaves
 * it alone.
 *
 * Cooldown length is the upstream's Retry-After and nothing else. When the upstream sent no
 * such header, verdict.retryAfterMs is null, and this function returns the account with the
 * status changed but no coolUntil -- reading null as "resume now" is the one reading section
 * 9.2 rules out, because it would put the account back on the wire immediately.
 */
export function accountAfterVerdict(account, verdict, nowMs) {
    if (verdict.rateClass === null)
        return account;
    return {
        ...account,
        status: STATUS_WHILE_COOLING[verdict.rateClass],
        cooldownReason: verdict.rateClass,
        ...(verdict.retryAfterMs === null ? {} : { coolUntil: nowMs + verdict.retryAfterMs }),
    };
}
/**
 * The key for "these accounts are cooling for the same reason", or null when the verdict does
 * not cool anything.
 *
 * Per account: the alias, because the two halves have to agree on something and nothing wider
 * is known. For an IP wall: no alias at all, deliberately -- the plugin cannot see which of its
 * accounts share an egress IP (docs/10 section 1), so it must not key a cooldown on an alias it
 * would then have to guess about. The provider alone is what it can honestly say.
 */
export function cooldownKeyOf(providerId, accountAlias, verdict) {
    if (verdict.rateClass === null)
        return null;
    if (verdict.rateClass === 'rpm_ip')
        return providerId;
    return providerId + ':' + accountAlias;
}
//# sourceMappingURL=cooldown.js.map