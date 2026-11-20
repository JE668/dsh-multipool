/**
 * Gate 2 and 3 (docs/04 section 3 and section 4): which account serves a session,
 * and when an (account, model) stops being served at all.
 *
 * The counter-intuitive rule this file exists to encode: on a 429 the session does NOT
 * move. Waiting out Retry-After costs one warm prefix cache; moving costs the whole
 * prefix and the prompt cache read discount that goes with it (AMD reads cached input
 * at 1/50 of prompt). 04 section 3.2 makes staying the default and migration the exception,
 * so `shouldMigrate` starts from `costStay > costWrong * migrationBias` with a bias of 3.
 *
 * The breaker is per (providerId, accountAlias, modelId), not per account: an account
 * that is cooking one model is still fine for the other four (04 section 4).
 */
/** 04 section 4: window is the larger of the last 20 results and the last 5 minutes. */
export const BREAKER_WINDOW_SAMPLES = 20;
export const BREAKER_WINDOW_MS = 5 * 60_000;
/** 04 section 4: err429Count / total > 0.5 trips. */
export const BREAKER_TRIP_RATIO = 0.5;
/**
 * We need a full window before the ratio means anything. Two 429s out of three are
 * 0.67, but they tell us nothing about a three-quarter healthy account; 04 section 4
 * says 20 samples or 5 minutes, and the ratio only means something once that window is full.
 */
export const BREAKER_MIN_SAMPLES = 20;
/** 04 section 4: open lasts 30s, then one probe is let through. */
export const BREAKER_OPEN_MS = 30_000;
/**
 * 04 section 5.1 table. Only these three rate classes move a session;
 * everything else is handled by waiting, refreshing the catalog, or by the caller.
 */
export const MIGRATING_RATE_KINDS = ['rpm_ip', 'daily_quota', 'auth'];
/**
 * 04 section 3.2 says a session migrates when the bound account is UNHEALTHY *and*
 * waiting costs more than moving. `rpm_key` explicitly does not migrate (does not migrate), and
 * `concurrency` explicitly does not lower RPM -- both are waits. This predicate is the
 * "should this even be on the migration table" test.
 */
export function mayMigrateOn(rateKind) {
    return MIGRATING_RATE_KINDS.includes(rateKind);
}
/**
 * 04 section 3.4: `costStay > costWrong * MIGRATION_BIAS`.
 *
 * costStay is the wall time the session would spend waiting, in ms; costWrong is that
 * wait expressed as the same currency so the two are comparable. We price one millisecond
 * of waiting against one millisecond of estimated prefix re-read, which keeps the bias a
 * pure multiplier on that estimate.
 */
export function shouldMigrate(costStayMs, costWrongMs, bias) {
    if (!Number.isFinite(costStayMs) || !Number.isFinite(costWrongMs))
        return false;
    if (bias <= 0)
        return false;
    return costStayMs > costWrongMs * bias;
}
/** 04 section 3.3 weights. Every coefficient here is configurable, none is official. */
export const LEAST_LOAD_WEIGHTS = {
    rpm: 1.0,
    inFlight: 0.6,
    daily: 0.2,
    lastMigrated: 0.3,
    recentlySucceeded: 0.05,
};
/** 04 section 3.3: 60s of success earns the bonus. */
export const RECENT_SUCCESS_MS = 60_000;
/**
 * 04 section 3.3. Lower is better. The three ratios are all 0..1 so the weights read
 * as shares of one comparable number; the two constants are the only non-ratio terms.
 */
export function leastLoadScore(candidate, context) {
    const w = LEAST_LOAD_WEIGHTS;
    const rpmRatio = candidate.rpmLimit > 0 ? candidate.rpmUsed / candidate.rpmLimit : 1;
    const flightRatio = candidate.concurrencyLimit > 0 ? candidate.inFlight / candidate.concurrencyLimit : 1;
    const dailyRatio = candidate.dailyQuota !== undefined && candidate.dailyQuota > 0 && candidate.dailyUsed !== undefined
        ? candidate.dailyUsed / candidate.dailyQuota
        : 0;
    let score = rpmRatio * w.rpm + flightRatio * w.inFlight + dailyRatio * w.daily;
    if (context.migratedFrom !== undefined && context.migratedFrom === candidate.accountAlias) {
        score += w.lastMigrated;
    }
    const lastOk = candidate.lastSuccessAtMs;
    if (lastOk !== undefined && context.nowMs - lastOk < RECENT_SUCCESS_MS) {
        score -= w.recentlySucceeded;
    }
    return score;
}
export function leastLoad(candidates, context) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const score = leastLoadScore(candidate, context);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}
export function createBindingStore() {
    const map = new Map();
    return {
        get: (sessionId) => map.get(sessionId),
        set: (binding) => {
            map.set(binding.sessionId, binding);
        },
        delete: (sessionId) => {
            map.delete(sessionId);
        },
    };
}
export function stickyPick(session, candidates, store, options, nowMs) {
    const binding = store.get(session.id);
    if (binding === undefined)
        return null;
    if (nowMs - binding.lastUsedAtMs >= options.tStickyIdleMs)
        return null;
    const match = candidates.find((candidate) => candidate.keyId === binding.keyId);
    return match ?? null;
}
/**
 * 04 section 4. One breaker per (providerId, accountAlias, modelId). A 429 on DeepSeek
 * must not take the same account out of service for Qwen, which is why the model is in
 * the key and not in a field beside it.
 *
 * The window is "the last 20 results, or the last 5 minutes, whichever covers more",
 * so a sample only leaves once it is *both* old enough and out of the top 20. Pruning
 * on either condition alone ignores the other half of that sentence.
 */
export class Breaker {
    clock;
    samples = [];
    openedAtMs = null;
    probing = false;
    constructor(clock) {
        this.clock = clock;
    }
    prune(atMs) {
        const floor = atMs - BREAKER_WINDOW_MS;
        // OR, not AND: the window is whichever of the two covers more (04 section 4).
        while (this.samples.length > 0 &&
            (this.samples.length > BREAKER_WINDOW_SAMPLES ||
                (this.samples[0]?.atMs ?? Number.POSITIVE_INFINITY) < floor)) {
            this.samples.shift();
        }
    }
    /** Record one finished request. A 2xx resets the open state after its probe. */
    record(error429, atMs = this.clock.now()) {
        this.samples.push({ atMs, error429 });
        this.prune(atMs);
        if (this.openedAtMs !== null && this.probing) {
            this.probing = false;
            if (!error429) {
                // The probe closed the breaker. The 429s that took it down are still in the
                // samples, and left there the next healthy call would re-trip on 19/20 alone
                // -- a permanently welded breaker. The probe is the only evidence that matters
                // now, so the window restarts from it.
                this.samples.length = 0;
                this.samples.push({ atMs, error429: false });
                this.openedAtMs = null;
            }
            else {
                // The probe failed: stay shut, and start a fresh 30s from now.
                this.openedAtMs = atMs;
            }
            return;
        }
        const total = this.samples.length;
        const errors = this.samples.filter((sample) => sample.error429).length;
        if (total >= BREAKER_MIN_SAMPLES && errors / total > BREAKER_TRIP_RATIO) {
            this.openedAtMs = atMs;
        }
    }
    /** 04 section 4: `open` lifts after 30s or after one unrelated success, whichever first. */
    state(atMs = this.clock.now()) {
        if (this.openedAtMs === null)
            return 'closed';
        return atMs - this.openedAtMs >= BREAKER_OPEN_MS ? 'half-open' : 'open';
    }
    /** Half-open admits exactly one request; everyone else waits for its verdict. */
    admit(atMs = this.clock.now()) {
        if (this.openedAtMs === null)
            return true;
        if (atMs - this.openedAtMs < BREAKER_OPEN_MS)
            return false;
        if (this.probing)
            return false;
        this.probing = true;
        return true;
    }
    snapshot(atMs = this.clock.now()) {
        return {
            state: this.state(atMs),
            samples: this.samples.length,
            errors429: this.samples.filter((sample) => sample.error429).length,
        };
    }
    reset() {
        this.samples.length = 0;
        this.openedAtMs = null;
        this.probing = false;
    }
}
//# sourceMappingURL=scheduler.js.map