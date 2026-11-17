import { describe, expect, it } from 'vitest'
import { estimateCost, isDecimalString, normalizeDecimal } from '../src/decimal.js'

/**
 * U-03 estimateCost — 十进制串精确计算（docs/07-ACCEPTANCE.md U-03, docs/02 §1.6/§1.7）
 *
 * 价格是「每 token 价格的字符串小数」，形如 '0.00000014' / '0.0000000028'。
 * 全程禁用 Number 浮点：1e6 * Number('0.0000000028') === 0.0028000000000000004。
 *
 * 契约：estimateCost(tokens: number, pricePerToken: string) => string | null
 *   - tokens 必须是非负安全整数，否则 null
 *   - pricePerToken 必须是非负十进制串（可带或不带小数点，禁止指数/hex/前后缀），否则 null
 *   - 结果为规范化十进制串：去掉尾随零与小数点，浮点式结果绝不出现
 *   - 未知价格（undefined / ''）→ null，不是 '0'、不是 0（铁律 5）
 */
describe('U-03 estimateCost (decimal string, no float)', () => {
  it('DoD: 1e6 tokens × 0.0000000028 === 0.0028 exactly', () => {
    expect(estimateCost(1_000_000, '0.0000000028')).toBe('0.0028')
  })

  it('float arithmetic is not exact at this scale (regression guard)', () => {
    // 1e6 * 2.8e-9 的双精度结果区间的 .toFixed(17) 不平滑 —— 十进制实现必须给出标称值。
    const total = '0.0029360128'
    // 双精度: (a * p) + (b * p') 的首尾会各飘一点 —— 十进制实现必须精确复原。
    const float = Number('1048576') * Number('0.0000000028') + Number('31002') * Number('0.0000000000014')
    expect(estimateCost(1_048_576, '0.0000000028')).toBe(total)
    expect(float.toFixed(20)).not.toBe(total)
  })

  it('prompt price: 100 tokens × 0.00000014 === 0.000014', () => {
    expect(estimateCost(100, '0.00000014')).toBe('0.000014')
  })

  it('AMD DeepSeek-V4-Flash usage sample (docs/02 §1.6)', () => {
    expect(estimateCost(31_002, '0.00000014')).toBe('0.00434028')
    expect(estimateCost(57_212, '0.00000028')).toBe('0.01601936')
  })

  it('zero tokens -> "0"', () => {
    expect(estimateCost(0, '0.00000014')).toBe('0')
  })

  it('unknown price is null, never 0 (铁律 5)', () => {
    expect(estimateCost(1000, undefined)).toBeNull()
    expect(estimateCost(1000, null)).toBeNull()
    expect(estimateCost(1000, '')).toBeNull()
    expect(estimateCost(1000, '   ')).toBeNull()
  })

  it('rejects exponent / junk / negative prices instead of silently going through float', () => {
    expect(estimateCost(1000, '1e-9')).toBeNull()
    expect(estimateCost(1000, '1E-9')).toBeNull()
    expect(estimateCost(1000, 'abc')).toBeNull()
    expect(estimateCost(1000, '0x10')).toBeNull()
    expect(estimateCost(1000, '-0.1')).toBeNull()
    expect(estimateCost(1000, '0.00000014usd')).toBeNull()
  })

  it('rejects negative / fractional / unsafe / non-finite token counts', () => {
    expect(estimateCost(-1, '0.1')).toBeNull()
    expect(estimateCost(1.5, '0.1')).toBeNull()
    expect(estimateCost(Number.NaN, '0.1')).toBeNull()
    expect(estimateCost(Number.POSITIVE_INFINITY, '0.1')).toBeNull()
    expect(estimateCost(Number.MAX_SAFE_INTEGER + 1, '0.1')).toBeNull()
  })

  it('normalises the result: no trailing zeros, no trailing dot, no leading zeros', () => {
    expect(estimateCost(10, '0.10')).toBe('1')
    expect(estimateCost(3, '0.5')).toBe('1.5')
    expect(estimateCost(1000, '0.0000001')).toBe('0.0001')
    expect(estimateCost(1000, '0.00000010')).toBe('0.0001')
  })

  it('exact on large token counts (decimal arithmetic keeps all digits)', () => {
    expect(estimateCost(123_456_789, '0.000000001')).toBe('0.123456789')
    expect(estimateCost(999_999_999, '0.00000028')).toBe('279.99999972')
  })
})

describe('decimal helpers', () => {
  it('isDecimalString accepts plain decimals only', () => {
    expect(isDecimalString('0.0000000028')).toBe(true)
    expect(isDecimalString('12')).toBe(true)
    expect(isDecimalString('.5')).toBe(true)
    expect(isDecimalString('5.')).toBe(true)
    expect(isDecimalString('1e-9')).toBe(false)
    expect(isDecimalString('-1')).toBe(false)
    expect(isDecimalString('0x10')).toBe(false)
    expect(isDecimalString('Infinity')).toBe(false)
    expect(isDecimalString('')).toBe(false)
  })

  it('normalizeDecimal trims zeros and dots', () => {
    expect(normalizeDecimal('1.2300')).toBe('1.23')
    expect(normalizeDecimal('1.000')).toBe('1')
    expect(normalizeDecimal('00.5')).toBe('0.5')
    expect(normalizeDecimal('.5')).toBe('0.5')
    expect(normalizeDecimal('5.')).toBe('5')
  })
})
