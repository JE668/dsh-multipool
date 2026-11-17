/**
 * 十进制字符串乘法（docs/07 U-03）
 *
 * 价格、pts、token 一律走 string + BigInt，**永远不碰 float**：
 * 双精度下 1e6 × Number('0.0000000028') 不等于精确的 0.0028，
 * 多日累加后 UI 上会出现「用掉了 0.0000000001 pts」这种不存在的尾巴。
 *
 * 产出一律去尾随零（0.0028 而非 0.00280，'10' 而非 '10.0'）。
 */

const FULL_RE = /^\d{1,15}(?:\.\d{1,20})?$/
/** 宽松形态：允许 '.5' / '5.' / 前导零，仅供 normalizeDecimal 用于输入清洗。 */
const TEXT_DECIMAL_RE = /^\d*\.?\d*$/

/** 是否是普通小数串：无符号、无指数、无空白。 */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && FULL_RE.test(value)
}

export function normalizeDecimal(raw: string): string {
  const text = raw.trim()
  if (!TEXT_DECIMAL_RE.test(text)) {
    throw new TypeError(`not a plain decimal string: ${JSON.stringify(raw)}`)
  }
  const [intPart = '0', fracPart = ''] = text.split('.')
  const intNorm = intPart.replace(/^0+(?=\d)/, '') || '0'
  const fracNorm = fracPart.replace(/0+$/, '')
  return fracNorm.length === 0 ? intNorm : `${intNorm}.${fracNorm}`
}

interface Scaled {
  readonly digits: bigint
  readonly places: number
}

function toScaled(value: string): Scaled | null {
  if (!isDecimalString(value)) return null
  const dot = value.indexOf('.')
  const intPart = dot === -1 ? value : value.slice(0, dot)
  const fracPart = dot === -1 ? '' : value.slice(dot + 1)
  const digits = BigInt(`${intPart}${fracPart}`)
  return { digits, places: fracPart.length }
}

function assertCount(n: number): void {
  if (!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new TypeError(`not a non-negative safe integer: ${String(n)}`)
  }
}

/** digits / 10^places 的十进制串，去尾随零；negative 时保留负号。 */
function render(digits: bigint, places: number, negative: boolean): string {
  const text = digits.toString().padStart(places + 1, '0')
  const cut = text.length - places
  const intPart = text.slice(0, cut)
  const fracPart = places === 0 ? '' : text.slice(cut).replace(/0+$/, '')
  const body = fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`
  return negative && /[1-9]/.test(body) ? `-${body}` : body
}

/** tokens × 每 token 单价。任一输入非法 → null（不返回 NaN/0 冒充值）。 */
export function estimateCost(tokens: number, pricePerToken: string | null | undefined): string | null {
  if (!Number.isSafeInteger(tokens) || tokens < 0) return null
  if (typeof pricePerToken !== 'string' || pricePerToken.trim().length === 0) return null
  const price = toScaled(pricePerToken.trim())
  if (price === null) return null
  const product = price.digits * BigInt(tokens)
  return render(product, price.places, false)
}

/** 字符串价格 × 整数倍数；倍数必须是安全整数。 */
export function mulDecimalByInt(price: string, factor: number): string {
  assertCount(factor)
  const op = toScaled(price)
  if (op === null) throw new TypeError(`not a decimal price: ${JSON.stringify(price)}`)
  return render(op.digits * BigInt(factor), op.places, false)
}

/** 两个十进制串相乘，截断到 places 位小数（不四舍五入，避免把截断尾巴显示成真实用量）。 */
export function mulDecimalTruncated(a: string, b: string, places: number): string {
  assertCount(places)
  const left = toScaled(a)
  const right = toScaled(b)
  if (left === null || right === null) return '0'
  const product = left.digits * right.digits
  const totalPlaces = left.places + right.places
  if (totalPlaces <= places) return render(product, places, false)
  const divisor = 10n ** BigInt(totalPlaces - places)
  return render(product / divisor, places, false)
}
