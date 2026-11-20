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
import type { Clock } from './clock.js';
import type { RateKind } from './contract.js';
/** 04 section 3.2: a session stays bound to its account for this long after its last request. */
export interface StickyBinding {
    readonly sessionId: string;
    readonly accountAlias: string;
    readonly keyId: string;
    readonly boundAtMs: number;
    readonly lastUsedAtMs: number;
}
/** 04 section 4: what the breaker measures, per account and model. */
export interface BreakerSample {
    readonly error429: boolean;
}
export type BreakerState = 'closed' | 'open' | 'half-open';
export interface BreakerSnapshot {
    readonly state: BreakerState;
    readonly samples: number;
    readonly errors429: number;
}
/** 04 section 4: window is the larger of the last 20 results and the last 5 minutes. */
export declare const BREAKER_WINDOW_SAMPLES = 20;
export declare const BREAKER_WINDOW_MS: number;
/** 04 section 4: err429Count / total > 0.5 trips. */
export declare const BREAKER_TRIP_RATIO = 0.5;
/**
 * We need a full window before the ratio means anything. Two 429s out of three are
 * 0.67, but they tell us nothing about a three-quarter healthy account; 04 section 4
 * says 20 samples or 5 minutes, and the ratio only means something once that window is full.
 */
export declare const BREAKER_MIN_SAMPLES = 20;
/** 04 section 4: open lasts 30s, then one probe is let through. */
export declare const BREAKER_OPEN_MS = 30000;
/**
 * 04 section 5.1 table. Only these three rate classes move a session;
 * everything else is handled by waiting, refreshing the catalog, or by the caller.
 */
export declare const MIGRATING_RATE_KINDS: readonly RateKind[];
/**
 * 04 section 3.2 says a session migrates when the bound account is UNHEALTHY *and*
 * waiting costs more than moving. `rpm_key` explicitly does not migrate (does not migrate), and
 * `concurrency` explicitly does not lower RPM -- both are waits. This predicate is the
 * "should this even be on the migration table" test.
 */
export declare function mayMigrateOn(rateKind: RateKind): boolean;
export interface SchedulerOptions {
    /** 04 section 3.2: idle time after which a binding stops counting. */
    readonly tStickyIdleMs: number;
    /** 04 section 3.4: how many times worse staying must be than moving. */
    readonly migrationBias: number;
}
/**
 * 04 section 3.4: `costStay > costWrong * MIGRATION_BIAS`.
 *
 * costStay is the wall time the session would spend waiting, in ms; costWrong is that
 * wait expressed as the same currency so the two are comparable. We price one millisecond
 * of waiting against one millisecond of estimated prefix re-read, which keeps the bias a
 * pure multiplier on that estimate.
 */
export declare function shouldMigrate(costStayMs: number, costWrongMs: number, bias: number): boolean;
export interface BreakerEntry {
    readonly atMs: number;
    readonly error429: boolean;
}
export interface Candidate {
    readonly accountAlias: string;
    readonly keyId: string;
    readonly modelId: string;
    readonly rpmLimit: number;
    readonly rpmUsed: number;
    readonly inFlight: number;
    readonly concurrencyLimit: number;
    readonly dailyQuota?: number;
    readonly dailyUsed?: number;
    readonly lastSuccessAtMs?: number;
}
export interface Session {
    readonly id: string;
}
/** 04 section 3.3 weights. Every coefficient here is configurable, none is official. */
export declare const LEAST_LOAD_WEIGHTS: {
    readonly rpm: 1;
    readonly inFlight: 0.6;
    readonly daily: 0.2;
    readonly lastMigrated: 0.3;
    readonly recentlySucceeded: 0.05;
};
/** 04 section 3.3: 60s of success earns the bonus. */
export declare const RECENT_SUCCESS_MS = 60000;
export interface ScoreContext {
    readonly session: Session;
    readonly nowMs: number;
    /** Account this session last moved away from, if it moved inside T_STICKY_IDLE. */
    readonly migratedFrom?: string;
}
/**
 * 04 section 3.3. Lower is better. The three ratios are all 0..1 so the weights read
 * as shares of one comparable number; the two constants are the only non-ratio terms.
 */
export declare function leastLoadScore(candidate: Candidate, context: ScoreContext): number;
export declare function leastLoad(candidates: readonly Candidate[], context: ScoreContext): Candidate | null;
/**
 * 04 section 3.2. The binding is honoured as long as the same *key* is still a
 * candidate and the session has not been idle past T_STICKY_IDLE. `boundAtMs` is the
 * last time the session issued a request on this key, not the time of binding:
 * otherwise a long continuous conversation would age out while it is still warm.
 */
export interface BindingStore {
    get(sessionId: string): StickyBinding | undefined;
    set(binding: StickyBinding): void;
    delete(sessionId: string): void;
}
export declare function createBindingStore(): BindingStore;
export declare function stickyPick(session: Session, candidates: readonly Candidate[], store: BindingStore, options: SchedulerOptions, nowMs: number): Candidate | null;
/**
 * 04 section 4. One breaker per (providerId, accountAlias, modelId). A 429 on DeepSeek
 * must not take the same account out of service for Qwen, which is why the model is in
 * the key and not in a field beside it.
 *
 * The window is "the last 20 results, or the last 5 minutes, whichever covers more",
 * so a sample only leaves once it is *both* old enough and out of the top 20. Pruning
 * on either condition alone ignores the other half of that sentence.
 */
export declare class Breaker {
    private readonly clock;
    private readonly samples;
    private openedAtMs;
    private probing;
    constructor(clock: Clock);
    private prune;
    /** Record one finished request. A 2xx resets the open state after its probe. */
    record(error429: boolean, atMs?: number): void;
    /** 04 section 4: `open` lifts after 30s or after one unrelated success, whichever first. */
    state(atMs?: number): BreakerState;
    /** Half-open admits exactly one request; everyone else waits for its verdict. */
    admit(atMs?: number): boolean;
    snapshot(atMs?: number): BreakerSnapshot;
    reset(): void;
}
//# sourceMappingURL=scheduler.d.ts.map