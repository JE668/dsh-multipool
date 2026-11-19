import type { Clock } from './clock.js'
import { AMD_RPM_ACCOUNT, AMD_RPM_KEY, AMD_WINDOW_MS } from './limits.js'
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
  readonly rpmAccount: number
  readonly rpmKey: number
  /** Fraction of the ceiling we are willing to spend (04 §2.2; catalog value). */
  readonly conservativeFactor: number
  /** How many clients share the account including us; 1 = we are alone (04 §7). */
  readonly assumedExternalClients: number
  /** Longest a caller will sit in queue before the proxy answers 503 itself (04 §3). */
  readonly maxWaitMs: number
  /**
   * How much worse staying must get than migrating before a bound session may leave its
   * account (04 §3.4). Sticky routing exists to keep the prefix cache warm, so this is
   * the price put on losing it. 04 section 3.4 gives 3.0 for AMD, whose cached input
   * reads at 1/50 of prompt (02 section 1.7), and 1.0 for the providers whose cached
   * price is zero or unknown.
   */
  readonly migrationBias: number
  /**
   * Idle time after which a session stops counting as bound (04 section 3.2). Past this the
   * cache would be cold anyway, so picking a fresh account costs nothing.
   */
  readonly tStickyIdleMs: number
}

export interface BudgetInput {
  readonly policy: AdmissionPolicy
  /** What the gateway itself last said is left this minute (02 §1.3), or null when it never said. */
  readonly headerRemaining?: number | null
}

export interface Budget {
  readonly admitRpm: number
  /** Where admitRpm came from, in evaluation order, for the UI "why this number" row. */
  readonly sources: readonly string[]
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
export function computeBudget(input: BudgetInput): Budget {
  const { policy } = input
  const sources: string[] = [
    `account=${policy.rpmAccount}`,
    `key=${policy.rpmKey}`,
    `factor=${policy.conservativeFactor}`,
    `clients=${policy.assumedExternalClients}`,
  ]
  const ceiling = Math.min(policy.rpmAccount, policy.rpmKey)
  let admitRpm = Math.floor((ceiling * policy.conservativeFactor) / policy.assumedExternalClients)
  if (input.headerRemaining != null && Number.isFinite(input.headerRemaining)) {
    const headroom = Math.max(0, Math.floor(input.headerRemaining))
    if (headroom < admitRpm) {
      sources.push(`header-remaining=${headroom}`)
      admitRpm = headroom
    }
  }
  if (admitRpm < 0) admitRpm = 0
  sources.unshift(`min(${policy.rpmAccount},${policy.rpmKey})*${policy.conservativeFactor}/${policy.assumedExternalClients}=${admitRpm}`)
  return { admitRpm, sources }
}

export interface Reservation {
  readonly ok: boolean
  /** Milliseconds until a slot frees, when !ok. */
  readonly waitMs: number
  readonly budget: Budget
}

/**
 * Sliding-window gate for ONE account.
 *
 * Every send is a send whatever path it took: chat, speech and systemone append to
 * the same list, and every later reservation sees them. There is no per-endpoint
 * bucket to construct, which is how 02 §1.1 gets honored by construction rather
 * than by a config flag someone can forget to set.
 */
export class AccountGate {
  private readonly sent: number[] = []
  private readonly clock: Clock
  private readonly policy: AdmissionPolicy
  private budget: Budget

  constructor(clock: Clock, policy: AdmissionPolicy) {
    this.clock = clock
    this.policy = policy
    this.budget = computeBudget({ policy })
  }

  get currentBudget(): Budget {
    return this.budget
  }

  /**
   * Calibrate the budget against a response header (04 §6.4). Only ever tightens:
   * 02 §1.3 says Remaining-User-RPM is "what is left this minute", a number that can
   * go down for reasons we never saw, so reading it as a raise would be trusting a
   * counter we cannot audit. A missing header keeps the current budget (no drift).
   */
  observeHeaders(headerRemaining: number | null): void {
    const next = computeBudget({ policy: this.policy, headerRemaining })
    this.budget = next.admitRpm <= this.budget.admitRpm ? next : this.budget
    this.evict(this.clock.now())
  }

  /** Success half of the gate: is there room now? */
  canAdmit(nowMs: number): boolean {
    this.evict(nowMs)
    return this.sent.length < this.budget.admitRpm
  }

  /**
   * Try to take a slot. Time spent queued never extends the window: only the
   * moment a request is actually released consumes it (04 §2.3's second reading).
   */
  tryAcquire(_endpoint: string): Reservation {
    const now = this.clock.now()
    this.evict(now)
    const budget = this.budget
    if (this.sent.length < budget.admitRpm) {
      this.sent.push(now)
      return { ok: true, waitMs: 0, budget }
    }
    const head = this.sent[0]
    if (head === undefined) return { ok: false, waitMs: 1, budget }
    return { ok: false, waitMs: Math.max(1, head + AMD_WINDOW_MS - now), budget }
  }

  /** What a reservation would report right now, without consuming anything (queue view). */
  peekWait(nowMs: number): number {
    this.evict(nowMs)
    if (this.sent.length < this.budget.admitRpm) return 0
    const head = this.sent[0]
    return head === undefined ? 0 : Math.max(0, head + AMD_WINDOW_MS - nowMs)
  }

  private evict(nowMs: number): void {
    while (this.sent.length > 0) {
      const oldest = this.sent[0]
      if (oldest === undefined || oldest + AMD_WINDOW_MS > nowMs) break
      this.sent.shift()
    }
  }

  clear(): void {
    this.sent.length = 0
  }
}

/**
 * Starting policy for one AMD account (04 section 2.2). Both ceilings are 02 facts; the two
 * coefficients are catalog values with source 'assume' (0.85 admission margin and
 * 1.5 assumedExternalClients), and they stay in the default so the gate never sends
 * more than the gateway meters sensed at 20 per minute.
 */
export const DEFAULT_AMD_POLICY: AdmissionPolicy = {
  rpmAccount: AMD_RPM_ACCOUNT,
  rpmKey: AMD_RPM_KEY,
  // 0.85 is the catalog admission margin and 1.5 its assumedExternalClients. User
  // decision 2026-11-19: both are part of the default, so the gate starts at 11 and
  // never sends more than the gateway meters. Sending the full 20 is a setting a
  // user can turn on for an account nothing else touches, not a default.
  conservativeFactor: 0.85,
  assumedExternalClients: 1.5,
  maxWaitMs: 60_000,
  migrationBias: 3.0,
  tStickyIdleMs: 15 * 60_000,
}
