import { describe, expect, it } from 'vitest'
import { estimateCost } from '../src/decimal.js'

// 02 §1.7 huge-number sanity: 价格串可能很长，整数化不能溢出 Number 精度。
describe('estimateCost — bigint internal precision', () => {
  it.each([
    [1_048_576, '0.00000014', '0.14680064'],
    [1_048_576, '0.00000028', '0.29360128'],
    [1_048_576, '0.0000000028', '0.0029360128'],
    [1, '0.000000000000000001', '0.000000000000000001'],
    [0, '0', '0'],
    [7, '0', '0'],
    [10, '1.0', '10'],
  ])('estimateCost(%i, %s) -> %s', (tokens, price, expected) => {
    expect(estimateCost(tokens, price)).toBe(expected)
  })

  it('safe-integer boundary: 2^53-1 tokens × 1e-9 stays exact digit-for-digit', () => {
    expect(estimateCost(Number.MAX_SAFE_INTEGER, '0.000000001')).toBe('9007199.254740991')
  })
})
