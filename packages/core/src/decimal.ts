/**
 * 十进制串精确算术（docs/02 §1.7、docs/07 U-03）
 *
 * 价格字段是「每 token 价格的字符串小数」，如 '0.00000014'。
 * 用 IEEE-754 双精度算：1e6 * 0.0000000028 → 0.0028000000000000004（不精确）。
 * 因此这里全程 BigInt 整数 + 小数位偏移，绝不经过 Number 一次。
 */

/** 非负十进制串：'123' / '123.456' / '.5' / '5.'；不接受指数、符号、十六进制、空串。 */
const DECIMAL_RE = /^\d*(?:\.\d*)?$/

export function isDecimalString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length === 0 || text === '.') return false
  return DECIMAL_RE.test(text)
}

interface Scaled {
  /** 去掉小数点后的数字，已剥除前导零；'0' 表示零。 */
  readonly digits: string
  /** 小数点右侧的位数。 */
  readonly fractionLength: number
}

function stripLeadingZeros(digits: string): string {
  let i = 0
  while (i < digits.length - 1 && digits.charCodeAt(i) === 48 /* '0' */) i++
  return digits.slice(i)
}

function toScaled(text: string): Scaled {
  const dot = text.indexOf('.')
  if (dot === -1) return { digits: stripLeadingZeros(text) || '0', fractionLength: 0 }
  const intPart = text.slice(0, dot)
  const fracPart = text.slice(dot + 1)
  const trimmed = fracPart.replace(/0+$/, '')
  return {
    digits: stripLeadingZeros(intPart + trimmed) || '0',
    fractionLength: trimmed.length,
  }
}

/**
 * 规范化十进制串：'1.2300' → '1.23'，'1.000' → '1'，'00.5' → '0.5'，
 * '5.' → '5'，'.5' → '0.5'。只做字符裁剪，不做数值转换。
 * 输入不是十进制串时抛 TypeError（调用方必须先 isDecimalString 判定）。
 */
export function normalizeDecimal(value: string): string {
  if (!isDecimalString(value)) throw new TypeError(`not a decimal string: ${value}`)
  const text = value.trim()
  const dot = text.indexOf('.')
  const intRaw = dot === -1 ? text : text.slice(0, dot)
  const fracRaw = dot === -1 ? '' : text.slice(dot + 1)
  const intPart = stripLeadingZeros(intRaw.length === 0 ? '0' : intRaw)
  const fracPart = fracRaw.replace(/0+$/, '')
  return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`
}

/** 把整数串按小数位切分：'12345', 4 → '1.2345'。 */
function scaleDown(digits: string, fractionLength: number): string {
  if (digits === '0') return '0'
  if (digits.length <= fractionLength) {
    return `0.${'0'.repeat(fractionLength - digits.length)}${digits}`
  }
  const cut = digits.length - fractionLength
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`
}

/**
 * tokens × pricePerToken，精确十进制串。
 *
 * @returns 规范化十进制串；tokens 非法 / 价格缺失或非法 → null（不是 0，铁律 5）
 */
export function estimateCost(tokens: number, pricePerToken: string | null | undefined): string | null {
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) return null
  if (typeof pricePerToken !== 'string' || !isDecimalString(pricePerToken)) return null

  const price = toScaled(pricePerToken.trim())
  const product = (BigInt(tokens) * BigInt(price.digits)).toString()
  if (price.fractionLength === 0) return product
  return normalizeDecimal(scaleDown(product, price.fractionLength))
}
