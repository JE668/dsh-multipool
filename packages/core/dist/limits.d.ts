/**
 * Numeric facts the scheduler uses during admission (docs/02 §1; docs/04 §2.2).
 *
 * Every number here has one source: docs/02-CONSTRAINTS.md, quoted verbatim in
 * catalog/limits.json under its own `source` tag. Nothing is rounded, nothing is
 * "about", and a number 02 does not state is simply absent from this file --
 * absence is how `unknown` is spelled in code. A value that was never published
 * must not acquire a default merely because a type wanted a plain `number`.
 *
 * The 3.0 migration bias is not a tuning knob: with AMD input_cache_read priced at
 * 1/50 of prompt (0.0000000028 / 0.00000014), moving a session to a fresh Key
 * throws the prefix cache away, which costs about 50x the cached-input rate back.
 * That ratio is why we would rather wait three-ish seconds than migrate for one.
 */
/** Per-API-Key platform admission ceiling (02 §1: "30 RPM per API Key"). */
export declare const AMD_RPM_KEY = 30;
/** Account-level gateway metering, 60s sliding window (02 §1.1 / §1.4 message "maximum 20 requests per minute"). */
export declare const AMD_RPM_ACCOUNT = 20;
/** Per-API-Key concurrency ceiling, the platform's hard cap (02 §1: "8 concurrent requests per API Key"). */
export declare const AMD_CONCURRENCY_KEY_HARD = 8;
/**
 * The scheduler's operating concurrency ceiling: the official 8 times the
 * conservative 0.75 factor (catalog `concurrencyKeyAdmit`). 02 owns the 8; the
 * 0.75 is oursaudit-able and configurable, never presented as an upstream fact.
 */
export declare const AMD_CONCURRENCY_KEY_ADMIT = 6;
/** Both limiter windows are the same 60 seconds (02 §1.1: "60 秒滑动窗口"). */
export declare const AMD_WINDOW_MS = 60000;
export declare function amdAdmissionRpm(): number;
//# sourceMappingURL=limits.d.ts.map