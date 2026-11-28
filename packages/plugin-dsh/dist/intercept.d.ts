/**
 * Intercept layer for the AMD dashboard panel.
 *
 * Every chat request DSH sends at AMD goes through `ctx.llm.stream`. Step 1 wraps that stream
 * so an AMD request is admitted by the gate and recorded as a `MetricsEvent` -- nothing more.
 * The gate is consulted but its wait is 0: nothing refuses, nothing delays, nothing changes a
 * routing decision. Step 2 (reject-before-429, cool, rotate) is opt-in later and will ask first.
 *
 * What this file does NOT do:
 * - It does NOT refuse or delay any request (gate wait is 0).
 * - It does NOT rotate keys on 429.
 * - It does NOT switch accounts on migration kinds.
 * - It does NOT own credentials injection, key-status watching, or channel/serveOn. apply()
 *   does those; this layer only reads the shared `facts` object and hooks into llm.stream.
 */
import { AccountGate, type MetricsStore } from '@dsh-multipool/core';
import type { SourceHooks } from './source.js';
import type { CredentialSeam } from './key-store.js';
export interface InterceptOptions {
    readonly facts?: Parameters<typeof import('./source.js').channelSourceFrom>[0];
    readonly nowMs?: () => number;
    readonly baseUrl?: string;
}
export interface InterceptHandle {
    readonly disposer: () => void;
    readonly gate: AccountGate;
    readonly store: MetricsStore;
    readonly hooks: SourceHooks;
}
export interface InterceptContext {
    readonly effect: (callback: () => () => void) => () => void;
    readonly inject?: (names: string[], callback: (child: {
        credentials?: CredentialSeam;
    }) => void) => () => void;
    readonly llm: {
        stream: (options: {
            provider: string;
            model: string;
            messages: unknown[];
            signal?: AbortSignal;
        }) => AsyncIterable<unknown>;
    };
}
export declare function createIntercept(ctx: InterceptContext, options?: InterceptOptions): InterceptHandle;
//# sourceMappingURL=intercept.d.ts.map