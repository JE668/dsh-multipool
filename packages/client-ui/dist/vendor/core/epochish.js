/**
 * X-RateLimit-Reset 归一化（docs/07 B-03；docs/02 §2.2 NIM、§1.3 AMD）
 *
 * 同一个头在不同 Provider 上是三种口径：
 *   - epoch 秒   '1730000123'
 *   - epoch 毫秒 '1730000123000'
 *   - 相对秒数   '12'
 *
 * 如果一律按「秒」处理，毫秒值会被放大 1000 倍 → 「等 5 万年」。
 * 判定顺序（< 1e9 相对秒、< 1e12 纪元秒、否则纪元毫秒）：
 *   1e9  秒 ≈ 1971-09；1e12 秒 ≈ 33658 年 —— 任何合理的相对等待都远小于 1e9
 *
 * @returns 绝对毫秒时间戳；缺失 / 非法 / 非正 → null（不假设「等于现在」）
 */
const MS_THRESHOLD = 1e12;
const SEC_THRESHOLD = 1e9;
export function parseEpochish(value, nowMs) {
    if (value === null || value === undefined)
        return null;
    let numeric;
    if (typeof value === 'number') {
        numeric = value;
    }
    else if (typeof value === 'string') {
        const text = value.trim();
        if (text.length === 0)
            return null;
        numeric = Number(text);
    }
    else {
        return null;
    }
    if (!Number.isFinite(numeric) || numeric <= 0)
        return null;
    if (numeric >= MS_THRESHOLD)
        return Math.round(numeric);
    if (numeric >= SEC_THRESHOLD)
        return Math.round(numeric * 1000);
    return Math.round(nowMs + numeric * 1000);
}
//# sourceMappingURL=epochish.js.map