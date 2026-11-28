import { DEFAULT_AMD_POLICY, AMD_RPM_ACCOUNT, AMD_RPM_KEY, AMD_WINDOW_MS, AccountGate, computeBudget, createSystemClock, createMetricsStore, shanghaiDayKey, READING_MINUTES, READING_ROWS, rowsOf, trendOf, } from './vendor/core/index.js';
import { readAmdUsage, withProviderUsage } from './usage.js';
import { USAGE_POLL_FLOOR_MS } from './vendor/core/index.js';
export async function createIntercept(ctx, options = {}) {
    const nowMs = options.nowMs ?? (() => createSystemClock().now());
    const clock = createSystemClock();
    // 1) Admission gate - same policy the rail prints
    const policy = DEFAULT_AMD_POLICY;
    const gate = new AccountGate(clock, policy);
    // 2) Metrics store - 30 day window, rollups forever
    const store = createMetricsStore(clock);
    // 3) Seam wiring - same pattern as apply()
    let seam;
    let lastAttemptMs;
    const onKeyStatus = options.onKeyStatus;
    // Key status reporting (re-read on reference change)
    const keyDisposer = injectSeam(ctx, (s) => {
        seam = s;
        if (seam === undefined)
            return;
        watchKeyStatusIntoFacts(ctx, seam, facts, onKeyStatus);
    });
    // 4) Facts object that the channel source reads
    const facts = { ...(options.facts ?? {}) };
    // 5) Hooks that the channel uses - now they do real work
    const hooks = {
        readFromSeam: () => readSeamNow(seam, facts, onKeyStatus),
        testUsage: (providerId) => askUsage(providerId, seam, nowMs, () => lastAttemptMs, stamp => { lastAttemptMs = stamp; }, facts, () => readSeamNow(seam, facts, onKeyStatus)),
        readUsage: (providerId) => askUsage(providerId, seam, nowMs, () => lastAttemptMs, stamp => { lastAttemptMs = stamp; }, facts, () => readSeamNow(seam, facts, onKeyStatus)),
        readDashboard: () => {
            const events = facts.events ?? [];
            return {
                trend: trendOf(events, nowMs(), READING_MINUTES),
                rows: rowsOf(events, READING_ROWS),
            };
        },
    };
    // 6) Channel + HTTP route (reusing apply's logic but with our facts & hooks)
    const { openChannel, serveOn, CHANNEL } = await import('./channel.js');
    const { RAIL_BUDGET } = await import('./index.js');
    const budget = RAIL_BUDGET;
    const source = (await import('./source.js')).channelSourceFrom(facts, nowMs, hooks);
    const channel = openChannel({ source, budget });
    const drops = [];
    const server = options.server;
    if (server === undefined) {
        drops.push(injectServer(ctx, (s) => {
            const webServer = s;
            if (webServer === undefined)
                return;
            drops.push(serveOn(webServer, channel, channel.source));
        }));
    }
    else {
        drops.push(serveOn(server, channel, channel.source));
    }
    drops.push(keyDisposer);
    // 7) LLM waterfall intercept - THIS IS THE KEY PART
    // We wrap the llm.stream call so every AMD request goes through our gate and gets recorded
    const originalStream = ctx.llm.stream;
    ctx.llm.stream = async function* (options) {
        // Only intercept AMD provider requests
        if (options.provider === 'amd') {
            // Gate admission (record the budget but don't wait yet - step 1 is read-only)
            const reservation = gate.tryAcquire('chat');
            const budgetNow = gate.currentBudget;
            // Build the forward URL and headers using the seam's key
            const keyFrame = await getKeyFromSeam(seam);
            const forwardedHeaders = await buildForwardHeaders(options, keyFrame);
            const targetUrl = `${(options.baseUrl ?? 'https://developer.amd.com.cn/radeon/api/v1').replace(/\/$/, '')}/v1/chat/completions`;
            const startMs = nowMs();
            let responseStatus = 0;
            let responseHeaders = {};
            let responseBody = '';
            let rateKind = null;
            let queueWaitMs = 0;
            let latencyMs = 0;
            try {
                // Forward the request
                const res = await fetch(targetUrl, {
                    method: 'POST',
                    headers: forwardedHeaders,
                    body: JSON.stringify(options.body ?? options),
                    signal: options.signal,
                });
                responseStatus = res.status;
                responseHeaders = Object.fromEntries(res.headers.entries());
                responseBody = await res.text();
                // Classify the response
                const { parseAmdError, classifyAmdRateClass, retryAfterMsOf } = await import('@dsh-multipool/core');
                const parsedError = parseAmdError(responseBody);
                rateKind = classifyAmdRateClass({ status: responseStatus, headers: responseHeaders, body: responseBody }, parsedError, retryAfterMsOf({ status: responseStatus, headers: responseHeaders, body: responseBody }, nowMs()));
                // Observe gate with response headers (account-level remaining RPM)
                const headerRemaining = parseHeaderRemaining(responseHeaders);
                if (headerRemaining !== null)
                    gate.observeHeaders(headerRemaining);
                // Note the outcome for the account
                if (rateKind !== null && seam !== undefined) {
                    // Note hook for the pool (would cool the account in step 2)
                    // For now just record the event
                }
            }
            catch (error) {
                // Network/transport error
                responseStatus = 0;
            }
            finally {
                latencyMs = nowMs() - startMs;
            }
            // Record metrics event
            const event = {
                ts: startMs,
                providerId: 'amd',
                accountAlias: keyFrame?.accountAlias ?? 'unknown',
                keyIdMasked: keyFrame?.keyIdMasked ?? '',
                modelId: options.model ?? 'unknown',
                requestId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
                status: responseStatus,
                latencyMs,
                attempt: 1,
                promptTokens: countPromptTokens(options.messages),
                completionTokens: 0,
                rateKind: rateKind ?? undefined,
                queueWaitMs,
                concurrencyAtSend: 1,
            };
            store.append(event);
            store.prune(nowMs());
            // Yield the original stream (we don't transform chunks in step 1)
            for await (const chunk of originalStream(options)) {
                yield chunk;
            }
            return;
        }
        // Non-AMD: pass through unchanged
        for await (const chunk of originalStream(options)) {
            yield chunk;
        }
    };
    return {
        disposer: () => {
            // Restore original stream
            ctx.llm.stream = originalStream;
            for (const drop of drops.reverse())
                drop();
            channel.close();
        },
        gate,
        store,
        hooks,
    };
}
// Helper: inject seam from credentials service
function injectSeam(ctx, onSeam) {
    const inject = ctx.inject;
    if (typeof inject !== 'function') {
        onSeam(undefined);
        return () => undefined;
    }
    try {
        return inject.call(ctx, ['credentials'], (child) => {
            onSeam(child.credentials);
        });
    }
    catch {
        onSeam(undefined);
        return () => undefined;
    }
}
// Helper: inject web server
function injectServer(ctx, onServer) {
    const inject = ctx.inject;
    if (typeof inject !== 'function') {
        onServer(undefined);
        return () => undefined;
    }
    try {
        return inject.call(ctx, ['webServer'], (child) => {
            onServer(child.webServer);
        });
    }
    catch {
        onServer(undefined);
        return () => undefined;
    }
}
// Helper: watch key status and update facts
async function watchKeyStatusIntoFacts(ctx, seam, facts, onRead) {
    let disposed = false;
    const { readKeyStatus, AMD_KEY_REF } = await import('./credentials.js');
    const { keyStateOf } = await import('./key-store.js');
    const { KEY_UPDATED_EVENT } = await import('./credentials.js');
    const read = async () => {
        if (disposed)
            return;
        const status = await readKeyStatus({ credentials: seam }, AMD_KEY_REF);
        if (disposed)
            return;
        if (status.kind === 'read') {
            const accounts = accountFromStatus(status.state);
            if (accounts !== undefined) {
                facts.accounts = accounts;
                facts.keyLayer = status.state.kind === 'configured' ? status.state.layer : undefined;
            }
        }
        if (onRead)
            onRead(status);
    };
    await read();
    if (typeof ctx.on !== 'function')
        return () => { disposed = true; };
    const forget = ctx.on(KEY_UPDATED_EVENT, (moved) => {
        if (moved === AMD_KEY_REF)
            read();
    });
    return () => {
        disposed = true;
        if (typeof forget === 'function')
            forget();
    };
}
// Helper: read seam now
async function readSeamNow(seam, facts, onRead) {
    if (seam === undefined)
        return false;
    const { readKeyStatus, AMD_KEY_REF } = await import('./credentials.js');
    const { keyStateOf } = await import('./key-store.js');
    const status = await readKeyStatus({ credentials: seam }, AMD_KEY_REF);
    if (status.kind !== 'read')
        return false;
    const accounts = accountFromStatus(status.state);
    if (accounts === undefined)
        return false;
    facts.accounts = accounts;
    facts.keyLayer = status.state.kind === 'configured' ? status.state.layer : undefined;
    if (status.state.kind !== 'configured')
        return false;
    if (onRead !== undefined)
        onRead(status);
    return true;
}
// Helper: convert KeyState to Account[]
function accountFromStatus(state) {
    if (state.kind !== 'configured')
        return undefined;
    return [{
            providerId: 'amd',
            accountAlias: 'AMD_API_KEY',
            keyIdMasked: 'AMD_API_KEY',
            enabled: true,
            limits: { rpmAccount: { value: 20, source: 'assume', ref: 'docs/02' }, dailyQuota: undefined, planTier: undefined },
            status: 'available',
            coolUntil: undefined,
            cooldownReason: undefined,
            lastSeenAt: undefined,
        }];
}
// Helper: ask usage
async function askUsage(providerId, seam, nowMs, lastAttemptMs, stamp, facts, readFromSeam) {
    const stale = lastAttemptMs();
    const insideFloor = stale !== undefined && nowMs() - stale < USAGE_POLL_FLOOR_MS;
    let layer = facts?.keyLayer;
    if (!insideFloor && seam !== undefined) {
        await readFromSeam();
        layer = facts?.keyLayer;
    }
    const attempt = await readAmdUsage({
        providerId,
        seam,
        reference: 'AMD_API_KEY',
        nowMs: nowMs(),
        ...(lastAttemptMs() === undefined ? {} : { lastAttemptMs: lastAttemptMs() }),
        ...(facts?.usage?.[providerId] === undefined ? {} : { previous: facts.usage[providerId] }),
        ...(layer === undefined ? {} : { layer }),
    });
    if (!attempt.tooSoon)
        stamp(attempt.atMs);
    if (facts !== undefined && attempt.usage !== null) {
        facts.usage = withProviderUsage(facts.usage, providerId, attempt.usage);
    }
    return attempt;
}
// Helper: get key from seam for forwarding
async function getKeyFromSeam(seam) {
    if (seam === undefined)
        return null;
    const stored = await seam.resolve('AMD_API_KEY');
    if (stored === undefined)
        return null;
    const masked = stored.value.slice(0, 4) + '...' + stored.value.slice(-4);
    return { accountAlias: 'AMD_API_KEY', keyIdMasked: masked, secret: stored.value };
}
// Helper: build forward headers
async function buildForwardHeaders(options, keyFrame) {
    const { stripClientAuth } = await import('@dsh-multipool/core');
    const forwarded = stripClientAuth(options.headers ?? {});
    if (keyFrame) {
        forwarded.authorization = `Bearer ${keyFrame.secret}`;
    }
    return forwarded;
}
// Helper: parse header remaining
function parseHeaderRemaining(headers) {
    const remaining = headers['x-ratelimit-remaining-user-rpm'] ?? headers['x-ratelimit-remaining'];
    if (remaining === undefined)
        return null;
    const n = parseInt(remaining, 10);
    return Number.isFinite(n) ? n : null;
}
// Helper: count prompt tokens (rough estimate)
function countPromptTokens(messages) {
    if (!messages || !messages.length)
        return 0;
    let total = 0;
    for (const m of messages) {
        if (m.content) {
            if (typeof m.content === 'string')
                total += m.content.length / 4;
            else if (Array.isArray(m.content)) {
                for (const block of m.content) {
                    if (block.type === 'text' && block.text)
                        total += block.text.length / 4;
                }
            }
        }
    }
    return Math.round(total);
}
//# sourceMappingURL=intercept.js.map