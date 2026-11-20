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
    dispose(): void;
}
export interface Clock {
    /** 挂钟毫秒（纪元）。只用于计算「窗口在哪一刻重置」。 */
    now(): number;
    /** 单调毫秒，只用于计算「等了多久」，不受系统时间调整影响。 */
    monotonic(): number;
    setTimeout(callback: () => void, delayMs: number): Disposable;
    setInterval(callback: () => void, delayMs: number): Disposable;
}
export interface FakeClock extends Clock {
    /** 同时推进挂钟与单调时钟，并按到期顺序追赶所有挂起定时器。 */
    advance(deltaMs: number): void;
    /** 卸掉所有 interval（测试收尾用）；timeout 是否已触发由 advance 决定。 */
    disposeIntervals(): void;
    /** 仍然挂起的 timeout 数（泄漏断言用）。 */
    pendingTimeoutCount(): number;
}
export interface SystemClockOptions {
    /** 挂钟来源，默认 Date.now；便于宿主覆写。 */
    readonly now?: () => number;
    /** 单调来源，默认 performance.now。 */
    readonly monotonic?: () => number;
}
export declare function createSystemClock(options?: SystemClockOptions): Clock;
export interface FakeClockOptions {
    /** 初始挂钟毫秒（纪元）。 */
    readonly now: number;
    /** 初始单调毫秒；默认 0。 */
    readonly monotonic?: number;
}
export declare function createFakeClock(options: FakeClockOptions): FakeClock;
//# sourceMappingURL=clock.d.ts.map