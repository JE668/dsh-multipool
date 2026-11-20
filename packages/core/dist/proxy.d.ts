/**
 * The local proxy (docs/06 T-1-g): DSH points its baseUrl here, we point the request
 * at AMD with a key from the pool. Three rules decide everything below.
 *
 * 1. The client's Authorization never leaves this machine. It is stripped before
 *    forwarding, whatever it contains, even when it looks like a real key -- the
 *    client was told to fill in a placeholder and we do not trust that it did.
 * 2. A request we cannot place is answered 503 with a Retry-After, never 429. 429
 *    from here would be indistinguishable from AMD's own and would teach callers to
 *    count retries against a limit that does not exist.
 * 3. X-RateLimit-* from AMD travels back renamed to X-DSH-MP-*: the client must not
 *    mistake our admission numbers for the upstream's.
 */
import type { Clock } from './clock.js';
/** Which AMD paths the proxy exposes, and how it forwards them. */
export declare const PROXY_ROUTES: readonly ['/v1/chat/completions', '/v1/audio/speech', '/v1/systemone', '/v1/messages', '/v1/messages/count_tokens', '/v1/models'];
export type ProxyRoute = (typeof PROXY_ROUTES)[number];
export declare const SATURATED_CODE = "dsh_multipool_saturated";
/** Header AMD sends back that we rename so the two counters never get confused. */
export declare const RATE_HEADER_PREFIX = "x-ratelimit-";
export declare const PROXY_HEADER_PREFIX = "x-dsh-mp-";
export interface PooledKey {
    readonly accountAlias: string;
    readonly keyId: string;
    readonly secret: string;
}
export interface ProxyResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}
export interface Saturated {
    readonly status: 503;
    readonly retryAfterMs: number;
}
/**
 * 04 section 5: a client may not charge its own rate limit against ours, so the header
 * comes back rewritten, and the same is true of every AMD quota header.
 */
export declare function renameRateHeaders(headers: Readonly<Record<string, string>>): Record<string, string>;
/** The client's own credentials must not survive the hop, whatever field they sat in. */
export declare function stripClientAuth(headers: Readonly<Record<string, string>>): Record<string, string>;
export declare function saturationBody(retryAfterMs: number): string;
/** `Retry-After` in whole seconds, rounded up, never 0: a 0 says "retry now". */
export declare function retryAfterSeconds(ms: number): string;
export declare function isProxyRoute(path: string): path is ProxyRoute;
export interface Lease {
    readonly key: PooledKey;
    release(): void;
}
/**
 * Round-robin over whatever keys have room in the current window. It is the fallback
 * for a client that sends no session id; sessions that do send one are served by
 * scheduler.ts, which keeps them on the same key to protect the prefix cache.
 */
export declare class KeyPool {
    private readonly clock;
    private readonly keys;
    private readonly admitRpm;
    private readonly concurrency;
    private readonly inFlight;
    private readonly sentAt;
    private cursor;
    constructor(clock: Clock, keys: readonly PooledKey[], admitRpm: number, concurrency: number);
    /** The key this request would get, or how long until one is free. */
    acquire(): Lease | {
        readonly retryAfterMs: number;
    };
    private evict;
}
export type Forward = (url: string, init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | null;
}) => Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly text: () => Promise<string>;
}>;
export interface ProxyRequest {
    readonly method: string;
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | null;
}
export interface ProxyDeps {
    readonly pool: KeyPool;
    readonly forward: Forward;
    /** Upstream origin, e.g. https://developer.amd.com.cn/radeon . */
    readonly baseUrl: string;
}
/**
 * One request in, one response out. The ordering matters and is the ticket:
 * admission happens BEFORE the key is picked, which happens BEFORE anything is
 * forwarded -- so a saturated proxy answers 503 having touched no upstream at all.
 */
export declare function handleProxyRequest(deps: ProxyDeps, request: ProxyRequest): Promise<ProxyResponse>;
//# sourceMappingURL=proxy.d.ts.map