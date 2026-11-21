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
import type { Account } from './contract.js';
import type { AmdVerdict } from './amd-error.js';
/**
 * The account as it stands after one verdict, or the same account when the verdict leaves
 * it alone.
 *
 * Cooldown length is the upstream's Retry-After and nothing else. When the upstream sent no
 * such header, verdict.retryAfterMs is null, and this function returns the account with the
 * status changed but no coolUntil -- reading null as "resume now" is the one reading section
 * 9.2 rules out, because it would put the account back on the wire immediately.
 */
export declare function accountAfterVerdict(account: Account, verdict: AmdVerdict, nowMs: number): Account;
/**
 * The key for "these accounts are cooling for the same reason", or null when the verdict does
 * not cool anything.
 *
 * Per account: the alias, because the two halves have to agree on something and nothing wider
 * is known. For an IP wall: no alias at all, deliberately -- the plugin cannot see which of its
 * accounts share an egress IP (docs/10 section 1), so it must not key a cooldown on an alias it
 * would then have to guess about. The provider alone is what it can honestly say.
 */
export declare function cooldownKeyOf(providerId: string, accountAlias: string, verdict: AmdVerdict): string | null;
//# sourceMappingURL=cooldown.d.ts.map