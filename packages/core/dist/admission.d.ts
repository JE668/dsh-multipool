import type { Clock } from './clock.js';
/**
 * The active gate (docs/04 §2; docs/07 A-01..A-03, A-14, A-15, A-18, S-01..S-04).
 *
 * One account owns two independent buckets that upstream enforces separately:
 *   - account gateway metering: 20 RPM over a 60 s sliding window (02 §1.1)
 *   - key platform admission:   30 RPM per API Key (02 §1)
 * A request has to clear both; whichever fails first decides how long we wait.
 * Sharing ONE 60 s bucket across /v1/chat/completions, /v1/audio/speech and /v1/systemone
 * (02 §1.1) is not modeling news here: this class refuses to key a
 * bucket by endpoint, so `reserve(endpoint)` accepts the argument and ignores it.
 *
 * The budget published here is floor(min(20, 30) * 0.85 / 1.5) = 11.
 * 04 §2.2 once carried 60*0.85/1.5 and 05 §2.3 once carried 24/39; both were
 * arithmetic over a ceiling no source states, and both generated guaranteed 429s.
 * Neither is reproduced anywhere in this file.
 */
export interface AdmissionPolicy {
    readonly rpmAccount: number;
    readonly rpmKey: number;
    /** Fraction of the ceiling we are willing to spend (04 §2.2; catalog value). */
    readonly conservativeFactor: number;
    /** How many clients share the account including us; 1 = we are alone (04 §7). */
    readonly assumedExternalClients: number;
    /** Longest a caller will sit in queue before the proxy answers 503 itself (04 §3). */
    readonly maxWaitMs: number;
    /**
     * How much worse staying must get than migrating before a bound session may leave its
     * account (04 §3.4). Sticky routing exists to keep the prefix cache warm, so this is
     * the price put on losing it. 04 section 3.4 gives 3.0 for AMD, whose cached input
     * reads at 1/50 of prompt (02 section 1.7), and 1.0 for the providers whose cached
     * price is zero or unknown.
     */
    readonly migrationBias: number;
    /**
     * Idle time after which a session stops counting as bound (04 section 3.2). Past this the
     * cache would be cold anyway, so picking a fresh account costs nothing.
     */
    readonly tStickyIdleMs: number;
}
export interface BudgetInput {
    readonly policy: AdmissionPolicy;
    /** What the gateway itself last said is left this minute (02 §1.3), or null when it never said. */
    readonly headerRemaining?: number | null;
}
export interface Budget {
    readonly admitRpm: number;
    /** Where admitRpm came from, in evaluation order, for the UI "why this number" row. */
    readonly sources: readonly string[];
}
/**
 * Budget for one account at one instant (04 §2.2 and §6.4).
 *
 * Start from min(rpmAccount, rpmKey): two limiters, both must pass, so the smaller
 * one binds. Apply the conservative factor, then divide by the assumed client count.
 * That division is the whole point of 04 §7: we only see our own traffic, and must not
 * spend upstream's capacity as if it were ours.
 *
 * A header never raises the budget above the ceiling (04 §6.4); it can only lower it.
 */
export declare function computeBudget(input: BudgetInput): Budget;
export interface Reservation {
    readonly ok: boolean;
    /** Milliseconds until a slot frees, when !ok. */
    readonly waitMs: number;
    readonly budget: Budget;
}
/**
 * Sliding-window gate for ONE account.
 *
 * Every send is a send whatever path it took: chat, speech and systemone append to
 * the same list, and every later reservation sees them. There is no per-endpoint
 * bucket to construct, which is how 02 §1.1 gets honored by construction rather
 * than by a config flag someone can forget to set.
 */
export declare class AccountGate {
    private readonly sent;
    private readonly clock;
    private readonly policy;
    private budget;
    constructor(clock: Clock, policy: AdmissionPolicy);
    get currentBudget(): Budget;
    /**
     * Calibrate the budget against a response header (04 §6.4). Only ever tightens:
     * 02 §1.3 says Remaining-User-RPM is "what is left this minute", a number that can
     * go down for reasons we never saw, so reading it as a raise would be trusting a
     * counter we cannot audit. A missing header keeps the current budget (no drift).
     */
    observeHeaders(headerRemaining: number | null): void;
    /** Success half of the gate: is there room now? */
    canAdmit(nowMs: number): boolean;
    /**
     * Try to take a slot. Time spent queued never extends the window: only the
     * moment a request is actually released consumes it (04 §2.3's second reading).
     */
    tryAcquire(_endpoint: string): Reservation;
    /** What a reservation would report right now, without consuming anything (queue view). */
    peekWait(nowMs: number): number;
    private evict;
    clear(): void;
}
/**
 * Starting policy for one AMD account (04 section 2.2). Both ceilings are 02 facts; the two
 * coefficients are catalog values with source 'assume' (0.85 admission margin and
 * 1.5 assumedExternalClients), and they stay in the default so the gate never sends
 * more than the gateway meters sensed at 20 per minute.
 */
export declare const DEFAULT_AMD_POLICY: AdmissionPolicy;
//# sourceMappingURL=admission.d.ts.map