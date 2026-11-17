/**
 * 上游 token 上限字段的解析（docs/02 §4.5、docs/07 U-02）
 *
 * Agnes 的 per-model 页把 context window 写成 '512K' / '1M'，单位口径三种。
 * '65.5K' 按 1024 进制是 67072，按同族写的 '65,536' 是 65536 —— 两种都说得通，
 * 所以**不归一化**：保留原串、value 置 null、ambiguous 标 true，UI 原样显示并带 ?。
 *
 * 只有明确写成数字 token（'65536 tokens' 这类）才给 value。
 */
export interface TokenCount {
  /** 明确可用的 token 数；歧义 / 不可解析时为 null。绝不猜。 */
  readonly value: number | null
  /** 上游原文串，UI 原样展示。 */
  readonly raw: string
  /** true = 单位有歧义，UI 必须带 ? 角标且禁止参与比较/排序/聚合。 */
  readonly ambiguous: boolean
}

const UNIT_TOKEN_RE = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:tokens?|tok)$/i
const AMBIGUOUS_UNIT_RE = /^\d+(?:\.\d+)?\s*[kKmM]$/

export function parseTokenCount(input: unknown): TokenCount | null {
  if (input === null || input === undefined || typeof input === 'boolean') return null

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) return null
    return { value: input, raw: String(input), ambiguous: false }
  }

  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (raw.length === 0) return null

  if (/^\d+$/.test(raw)) {
    const value = Number(raw)
    return Number.isSafeInteger(value) ? { value, raw, ambiguous: false } : null
  }

  const tokenMatch = UNIT_TOKEN_RE.exec(raw)
  if (tokenMatch !== null) {
    const value = Number(tokenMatch[1]!.replace(/,/g, ''))
    return Number.isSafeInteger(value) ? { value, raw, ambiguous: false } : null
  }

  if (AMBIGUOUS_UNIT_RE.test(raw)) {
    return { value: null, raw, ambiguous: true }
  }

  return null
}
