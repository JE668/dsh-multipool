import { describe, expect, it } from 'vitest'
import { maskKey, scrubSecrets } from '../src/secret.js'

/**
 * U-04 maskKey / scrubSecrets（docs/03 §7, docs/02 §1.5, docs/07 U-04）
 *
 * maskKey(key)       -> `rc-…1a2b` 风格：保留已知前缀 + 最后 4 位
 * scrubSecrets(text) -> 日志/导出/错误报告里所有形如 (rc-|sk-|cpk-)[A-Za-z0-9]{8,} 的串
 *                       替换成 `<prefix>…`，全文不再出现原始 Key。
 *
 * 铁律：一条 DSH 日志里出现 3 个伪造 Key（sk- / rc- / cpk- 前缀），
 * 输出「只剩前缀 + …」，且原文里的完整 Key 串一个都不能出现。
 */
const FAKE_KEYS = [
  'sk-0000FAKEFAKEFAKEFAKE0123456789ab',
  'rc-0000FAKEFAKEFAKEFAKE0123456789abcd',
  'cpk-live-FAKEFAKEFAKE0123456789abcdef',
]

describe('maskKey', () => {
  it('recognised prefixes: keeps prefix + last 4', () => {
    expect(maskKey('rc-abcdefgh1234')).toBe('rc-…1234')
    expect(maskKey('sk-abcdefgh9f8e')).toBe('sk-…9f8e')
    expect(maskKey('cpk-abcdefgh5678')).toBe('cpk-…5678')
  })

  it('short keys collapse fully instead of leaking', () => {
    expect(maskKey('rc-abc')).toBe('rc-…')
    expect(maskKey('abc')).toBe('…')
  })

  it('empty / undefined -> a placeholder that is not a key', () => {
    expect(maskKey('')).toBe('(上游未提供)')
    expect(maskKey(undefined)).toBe('(上游未提供)')
  })

  it('never returns the input intact', () => {
    for (const k of FAKE_KEYS) {
      expect(maskKey(k)).not.toBe(k)
    }
  })
})

describe('scrubSecrets (03 §7 global scrub regex)', () => {
  it('DoD: a log line with 3 fake keys keeps only prefix + …', () => {
    const line =
      `auth failed: used ${FAKE_KEYS[0]} then ${FAKE_KEYS[1]}, fallback ${FAKE_KEYS[2]}`
    const out = scrubSecrets(line)
    for (const k of FAKE_KEYS) {
      expect(out).not.toContain(k)
    }
    expect(out).toContain('sk-…')
    expect(out).toContain('rc-…')
    expect(out).toContain('cpk-…')
  })

  it('scrubs every occurrence, not just the first', () => {
    expect(scrubSecrets(`${FAKE_KEYS[1]} ${FAKE_KEYS[1]}`)).toBe('rc-… rc-…')
  })

  it('scrubs keys embedded in JSON / headers', () => {
    const out = scrubSecrets(
      `{"authorization":"Bearer rc-0123456789abcdefgh","x":"${FAKE_KEYS[0]}"}`,
    )
    expect(out).toBe('{"authorization":"Bearer rc-…","x":"sk-…"}')
  })

  it('leaves short non-secret tokens and plain text alone', () => {
    const text = 'status=429 retry-after=60 model=DeepSeek-V4-Flash sk-short rc-x'
    expect(scrubSecrets(text)).toBe(text)
  })

  it('handles undefined / null / empty safely', () => {
    expect(scrubSecrets('')).toBe('')
    expect(scrubSecrets(undefined)).toBe('')
    expect(scrubSecrets(null)).toBe('')
  })

  it('is idempotent', () => {
    const once = scrubSecrets(`key=${FAKE_KEYS[0]}`)
    expect(once).toBe('key=sk-…')
    expect(scrubSecrets(once)).toBe(once)
  })
})
