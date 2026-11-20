/**
 * Retry-After 解析（docs/02 §1.5、docs/04 §5.2；docs/07 U-01）
 *
 * RFC 9110 允许两种形态：
 *   Retry-After: 120                  → delta-seconds
 *   Retry-After: Wed, 21 Oct 2026 ... → HTTP-date
 *
 * 契约：返回毫秒；缺失 / 不可解析 → null；'0' → 0（「立刻可重试」不是「没有头」）。
 * 铁律 4：这里绝不 clamp、绝不把上游值替换成本地的默认值 —— 那个决定属于调用方，
 * 且调用方只能用「加抖动」的方式在 Retry-After 之上等待，不得缩短。
 */
export function parseRetryAfter(value, nowMs) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0)
            return null;
        return Math.round(value * 1000);
    }
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    if (text.length === 0)
        return null;
    if (/^-\d+$/.test(text))
        return null;
    if (/^\d+$/.test(text)) {
        const seconds = Number(text);
        return Number.isSafeInteger(seconds) ? seconds * 1000 : null;
    }
    const at = Date.parse(text);
    if (Number.isNaN(at))
        return null;
    return Math.max(0, at - nowMs);
}
//# sourceMappingURL=retry-after.js.map