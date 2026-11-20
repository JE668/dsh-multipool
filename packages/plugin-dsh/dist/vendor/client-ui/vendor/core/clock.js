/**
 * 时钟端口（docs/06 T-0-b；Z-03 时间源纪律）
 *
 * **本文件是整个仓库唯一允许触达 `Date.now()` / `new Date()` / `setTimeout` / `setInterval` 的地方。**
 * 其他所有源码（scheduler / engine / 插件 / 浏览器半边）都只能接收注入的 `Clock`。
 * Z-03 扫描的是本文件以外的匹配。
 *
 * 生产环境用 `createSystemClock()`，单测用 `createFakeClock()`。
 */
export function createSystemClock(options = {}) {
    const readWall = options.now ?? (() => Date.now());
    const readMonotonic = options.monotonic ??
        (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    // 配对一次，使 now() 与 monotonic() 在本时钟实例里同源，避免两套钟各自跳动。
    const baseWall = readWall();
    const baseMono = readMonotonic();
    const now = () => baseWall + (readMonotonic() - baseMono);
    return {
        now,
        monotonic: readMonotonic,
        setTimeout(callback, delayMs) {
            if (!Number.isFinite(delayMs) || delayMs < 0)
                return { dispose: () => undefined };
            if (delayMs === 0) {
                callback();
                return { dispose: () => undefined };
            }
            const handle = setTimeout(callback, delayMs);
            return { dispose: () => clearTimeout(handle) };
        },
        setInterval(callback, delayMs) {
            const handle = setInterval(callback, delayMs);
            return { dispose: () => clearInterval(handle) };
        },
    };
}
export function createFakeClock(options) {
    let wall = options.now;
    let mono = options.monotonic ?? 0;
    let seq = 0;
    const timers = [];
    function intervalPeriod(raw) {
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }
    function schedule(callback, delayMs, period) {
        const timer = {
            dueMonotonic: mono + Math.max(0, delayMs),
            seq: seq++,
            period,
            callback,
            disposed: false,
        };
        timers.push(timer);
        return {
            dispose() {
                timer.disposed = true;
            },
        };
    }
    /**
     * 推进时间，并追赶所有在目标时刻之前到期的回调。
     * 追赶到的时刻可以超过请求的 delta —— 与真实 timer 相同：先到期的先触发，
     * 后触发的那一个回调看到的是「它自己到期时」的时间，而不是一次性跳到终点。
     */
    function advance(deltaMs) {
        if (!Number.isFinite(deltaMs) || deltaMs <= 0)
            return;
        const target = mono + deltaMs;
        for (;;) {
            const next = nextDue(target);
            if (next === null)
                break;
            wall += next.dueMonotonic - mono;
            mono = next.dueMonotonic;
            if (next.period === 0) {
                next.disposed = true;
            }
            else {
                next.dueMonotonic = mono + next.period;
            }
            next.callback();
        }
        if (target > mono) {
            wall += target - mono;
            mono = target;
        }
    }
    function nextDue(target) {
        let best = null;
        for (const t of timers) {
            if (t.disposed || t.dueMonotonic > target)
                continue;
            if (best === null || t.dueMonotonic < best.dueMonotonic || (t.dueMonotonic === best.dueMonotonic && t.seq < best.seq)) {
                best = t;
            }
        }
        return best;
    }
    return {
        now: () => wall,
        monotonic: () => mono,
        setTimeout: (callback, delayMs) => schedule(callback, Number(delayMs), 0),
        setInterval: (callback, delayMs) => schedule(callback, Number(delayMs), intervalPeriod(delayMs)),
        advance,
        disposeIntervals() {
            for (const t of timers)
                if (t.period > 0)
                    t.disposed = true;
        },
        pendingTimeoutCount() {
            return timers.filter(t => !t.disposed && t.period === 0).length;
        },
    };
}
//# sourceMappingURL=clock.js.map