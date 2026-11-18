import { describe, expect, it } from 'vitest'
import { createFakeClock, createSystemClock, type FakeClock } from '../src/clock.js'

/**
 * Z-03 时间源纪律（docs/03 §2 / docs/06 T-0-b）
 *
 * 业务代码只能通过注入的 `Clock` 取时间。`packages/core/src/clock.ts` 是唯一允许
 * 直接触达 `Date.now()` / `new Date()` / `setTimeout` / `setInterval` 的地方；
 * 其余包的 Z-03 扫描会 grep 这些符号。
 *
 * 这份测试同时把 Clock 契约钉住：单调性、可推进、可挂起等待。
 */
describe('clock.ts port (Z-03)', () => {
  it('FakeClock.now() returns the injected wall time and never moves by itself', async () => {
    const clock = createFakeClock({ now: 1_788_000_000_000 })
    expect(clock.now()).toBe(1_788_000_000_000)
    expect(clock.now()).toBe(1_788_000_000_000)
  })

  it('FakeClock.monotonic advances only with advance()', () => {
    const clock: FakeClock = createFakeClock({ now: 1000 })
    const t0 = clock.monotonic()
    clock.advance(500)
    expect(clock.monotonic() - t0).toBe(500)
    expect(clock.now()).toBe(1500)
  })

  it('Clock.set returns a Disposable that clears the timer', () => {
    const clock = createFakeClock({ now: 0 })
    let fired = 0
    const handle = clock.setTimeout(() => fired++, 100)
    expect(typeof handle.dispose).toBe('function')
    handle.dispose()
    clock.advance(200)
    expect(fired).toBe(0)
  })

  it('Clock.setTimeout fires once at the due monotonic instant', () => {
    const clock = createFakeClock({ now: 0 })
    const order: string[] = []
    clock.setTimeout(() => order.push('a'), 200)
    clock.setTimeout(() => order.push('b'), 100)
    expect(order).toHaveLength(0)

    clock.advance(100)
    expect(order).toEqual(['b'])
    clock.advance(200)
    expect(order).toEqual(['b', 'a'])
  })

  it('Clock.setInterval repeats and can be disposed', () => {
    const clock = createFakeClock({ now: 0 })
    let n = 0
    clock.setInterval(() => n++, 1000)
    clock.advance(2999)
    expect(n).toBe(2)
    clock.advance(1)
    expect(n).toBe(3)
    clock.disposeIntervals()
    clock.advance(5000)
    expect(n).toBe(3)
  })

  // setInterval(cb, 0) 的真身是「每个 tick 到期」，周期若为 0 会在 advance 里无限自旋。
  // 契约：周期被夹到 1 单调毫秒，advance(1000) 最多触发 1001 次，且必然终止。
  // 非法周期（0 / 负数 / NaN）一旦让回调在 dueMonotonic 原地重排，advance 就是死循环 ——
  // 这条用例跑在 vitest 的 testTimeout 之外，所以必须让计数本身有硬上限。
  it('setInterval with 0 / negative / NaN delay does not spin forever', () => {
    const probe = (bad: number): number => {
      const clock = createFakeClock({ now: 0 })
      let n = 0
      const handle = clock.setInterval(() => {
        n++
        if (n > 10_000) handle.dispose()
      }, bad)
      clock.advance(1000)
      clock.disposeIntervals()
      return n
    }
    for (const bad of [0, -5, Number.NaN]) {
      const n = probe(bad)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(10_001)
    }
  })
})

describe('createSystemClock (injected sources, no real waiting)', () => {
  const makeSources = () => {
    let wall = 1788000000000
    let mono = 100
    return {
      now: () => wall,
      monotonic: () => mono,
      tick: (ms: number) => {
        wall += ms
        mono += ms
      },
    }
  }

  it('now() follows the monotonic source, not the wall source', () => {
    const src = makeSources()
    const clock = createSystemClock({ now: src.now, monotonic: src.monotonic })
    expect(clock.now()).toBe(1788000000000)
    src.tick(250)
    src.tick(750)
    expect(clock.now()).toBe(1788000001000)
    expect(clock.monotonic()).toBe(1100)
  })

  it('never schedules non-finite or negative delays, and never throws', () => {
    let called = 0
    const clock = createSystemClock({ now: () => 0, monotonic: () => 0 })
    const timer = clock.setTimeout(() => called++, 5000)
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const junk = clock.setTimeout(() => called++, bad)
      expect(typeof junk.dispose).toBe('function')
      junk.dispose()
      expect(() => junk.dispose()).not.toThrow()
    }
    timer.dispose()
    expect(called).toBe(0)
  })

  it('timeout at 0 fires synchronously, and disposing it afterwards is a no-op', () => {
    const clock = createSystemClock({ now: () => 0, monotonic: () => 0 })
    let called = 0
    const d = clock.setTimeout(() => called++, 0)
    expect(called).toBe(1)
    d.dispose()
    expect(called).toBe(1)
  })

  it('interval handle can be disposed without waiting', () => {
    const clock = createSystemClock({ now: () => 0, monotonic: () => 0 })
    let called = 0
    const h = clock.setInterval(() => called++, 60000)
    h.dispose()
    expect(called).toBe(0)
  })

  // T-1-f / S-01 依赖这几条读法：pendingTimeoutCount 只数 setTimeout，
  // 且「一次性定时器要么被 dispose 掉、要么触发后再也不数」必须成立。
  it('pendingTimeoutCount counts only one-shot timers, not intervals', () => {
    const clock = createFakeClock({ now: 0 })
    expect(clock.pendingTimeoutCount()).toBe(0)
    const a = clock.setTimeout(() => undefined, 1_000)
    const b = clock.setInterval(() => undefined, 1_000)
    expect(clock.pendingTimeoutCount()).toBe(1)
    a.dispose()
    expect(clock.pendingTimeoutCount()).toBe(0)
    b.dispose()
    expect(clock.pendingTimeoutCount()).toBe(0)
  })

  it('a fired timeout leaves the pending set', () => {
    const clock = createFakeClock({ now: 0 })
    let n = 0
    clock.setTimeout(() => n++, 500)
    expect(clock.pendingTimeoutCount()).toBe(1)
    clock.advance(499)
    expect(clock.pendingTimeoutCount()).toBe(1)
    clock.advance(1)
    expect(clock.pendingTimeoutCount()).toBe(0)
    expect(n).toBe(1)
  })

  it('disposeIntervals stops every interval and reports no pending timeouts', () => {
    const clock = createFakeClock({ now: 0 })
    let ticks = 0
    clock.setInterval(() => ticks++, 100)
    clock.setTimeout(() => ticks++, 100)
    clock.advance(350)
    expect(ticks).toBe(4)
    clock.disposeIntervals()
    clock.advance(350)
    expect(ticks).toBe(4)
    expect(clock.pendingTimeoutCount()).toBe(0)
  })
})
