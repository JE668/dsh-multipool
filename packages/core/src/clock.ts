/**
 * 时钟端口（docs/06 T-0-b；Z-03 时间源纪律）
 *
 * **本文件是整个仓库唯一允许触达 `Date.now()` / `new Date()` / `setTimeout` / `setInterval` 的地方。**
 * 其他所有源码（scheduler / engine / 插件 / 浏览器半边）都只能接收注入的 `Clock`。
 * Z-03 扫描的是本文件以外的匹配。
 *
 * 生产环境用 `createSystemClock()`，单测用 `createFakeClock()`。
 */

export interface Disposable {
  dispose(): void
}

export interface Clock {
  /** 挂钟毫秒（纪元）。只用于计算「窗口在哪一刻重置」。 */
  now(): number
  /** 单调毫秒，只用于计算「等了多久」，不受系统时间调整影响。 */
  monotonic(): number

  setTimeout(callback: () => void, delayMs: number): Disposable
  setInterval(callback: () => void, delayMs: number): Disposable
}

export interface FakeClock extends Clock {
  /** 同时推进挂钟与单调时钟，并按到期顺序追赶所有挂起定时器。 */
  advance(deltaMs: number): void
  /** 卸掉所有 interval（测试收尾用）；timeout 是否已触发由 advance 决定。 */
  disposeIntervals(): void
  /** 仍然挂起的 timeout 数（泄漏断言用）。 */
  pendingTimeoutCount(): number
}

export interface SystemClockOptions {
  /** 挂钟来源，默认 Date.now；便于宿主覆写。 */
  readonly now?: () => number
  /** 单调来源，默认 performance.now。 */
  readonly monotonic?: () => number
}

export function createSystemClock(options: SystemClockOptions = {}): Clock {
  const readWall = options.now ?? (() => Date.now())
  const readMonotonic =
    options.monotonic ??
    (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))

  // 配对一次，使 now() 与 monotonic() 在本时钟实例里同源，避免两套钟各自跳动。
  const baseWall = readWall()
  const baseMono = readMonotonic()
  const now = () => baseWall + (readMonotonic() - baseMono)

  return {
    now,
    monotonic: readMonotonic,
    setTimeout(callback: () => void, delayMs: number): Disposable {
      if (!Number.isFinite(delayMs) || delayMs < 0) return { dispose: () => undefined }
      if (delayMs === 0) {
        callback()
        return { dispose: () => undefined }
      }
      const handle = setTimeout(callback, delayMs)
      return { dispose: () => clearTimeout(handle) }
    },
    setInterval(callback: () => void, delayMs: number): Disposable {
      const handle = setInterval(callback, delayMs)
      return { dispose: () => clearInterval(handle) }
    },
  }
}

interface PendingTimer {
  dueMonotonic: number
  readonly seq: number
  readonly period: number
  readonly callback: () => void
  disposed: boolean
}

export interface FakeClockOptions {
  /** 初始挂钟毫秒（纪元）。 */
  readonly now: number
  /** 初始单调毫秒；默认 0。 */
  readonly monotonic?: number
}

export function createFakeClock(options: FakeClockOptions): FakeClock {
  let wall = options.now
  let mono = options.monotonic ?? 0
  let seq = 0
  const timers: PendingTimer[] = []

  function schedule(callback: () => void, delayMs: number, period: number): Disposable {
    const timer: PendingTimer = {
      dueMonotonic: mono + Math.max(0, delayMs),
      seq: seq++,
      period,
      callback,
      disposed: false,
    }
    timers.push(timer)
    return {
      dispose() {
        timer.disposed = true
      },
    }
  }

  /**
   * 推进时间，并追赶所有在目标时刻之前到期的回调。
   * 追赶到的时刻可以超过请求的 delta —— 与真实 timer 相同：先到期的先触发，
   * 后触发的那一个回调看到的是「它自己到期时」的时间，而不是一次性跳到终点。
   */
  function advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return
    const target = mono + deltaMs
    for (;;) {
      const next = nextDue(target)
      if (next === null) break
      wall += next.dueMonotonic - mono
      mono = next.dueMonotonic
      if (next.period === 0) {
        next.disposed = true
      } else {
        next.dueMonotonic = mono + next.period
      }
      next.callback()
    }
    if (target > mono) {
      wall += target - mono
      mono = target
    }
  }

  function nextDue(target: number): PendingTimer | null {
    let best: PendingTimer | null = null
    for (const t of timers) {
      if (t.disposed || t.dueMonotonic > target) continue
      if (best === null || t.dueMonotonic < best.dueMonotonic || (t.dueMonotonic === best.dueMonotonic && t.seq < best.seq)) {
        best = t
      }
    }
    return best
  }

  return {
    now: () => wall,
    monotonic: () => mono,
    setTimeout: (callback, delayMs) => schedule(callback, Number(delayMs), 0),
    setInterval: (callback, delayMs) => schedule(callback, Number(delayMs), Math.max(1, Number(delayMs))),
    advance,
    disposeIntervals() {
      for (const t of timers) if (t.period > 0) t.disposed = true
    },
    pendingTimeoutCount() {
      return timers.filter(t => !t.disposed && t.period === 0).length
    },
  }
}
