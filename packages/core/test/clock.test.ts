import { describe, expect, it } from 'vitest'
import { createFakeClock, type FakeClock } from '../src/clock.js'

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
})
