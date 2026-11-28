import { AccountGate, type MetricsStore } from '@dsh-multipool/core';
import type { SourceHooks } from './source.js';
import type { CredentialSeam } from './key-store.js';
/**
 * This is the intercept layer the panel needs: every chat request that DSH points at AMD
 * goes through here, gets admitted, recorded, and classified -- without changing any
 * decisions yet. The wire to the proxy is already in core/proxy.ts; this file wires the
 * gate, the pool, the store, and the hooks so the panel has real numbers.
 *
 * What this file does NOT do yet:
 * - It does NOT refuse or delay any request (the gate is consulted but its wait is 0).
 * - It does NOT rotate keys on 429 (the note hook fires but the gate does not cool).
 * - It does NOT switch accounts on migration kinds (scheduler.ts stays unused).
 *
 * The only thing it does is record: every finished call becomes a MetricsEvent, the
 * gate's current budget is observed, and the panel's hooks readUsage/readDashboard
 * return real readings instead of "nothing recorded yet".
 *
 * Wire it by passing a ctx that has:
 *   - ctx.effect
 *   - ctx.inject (for credentials + webServer)
 *   - ctx.llm (the LLM runtime, so we can intercept the stream waterfall)
 *
 * The returned disposer tears everything down.
 */
export interface InterceptOptions {
    readonly facts?: Parameters<typeof import('./source.js').channelSourceFrom>[0];
    readonly nowMs?: () => number;
    readonly onKeyStatus?: (status: import('./credentials.js').KeyStatus) => void;
    readonly acceptsWrites?: boolean;
    readonly server?: import('./channel.js').RouteServer;
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
        webServer?: import('./channel.js').RouteServer;
    }) => void) => () => void;
    readonly on?: (name: string, listener: (...args: readonly unknown[]) => void) => unknown;
    readonly llm: {
        stream: (options: {
            provider: string;
            model: string;
            messages: unknown[];
            signal?: AbortSignal;
        }) => AsyncIterable<unknown>;
    };
}
export declare function createIntercept(ctx: InterceptContext, options?: InterceptOptions): Promise<InterceptHandle>;
//# sourceMappingURL=intercept.d.ts.map