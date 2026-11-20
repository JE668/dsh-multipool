/**
 * 十进制字符串乘法（docs/07 U-03）
 *
 * 价格、pts、token 一律走 string + BigInt，**永远不碰 float**：
 * 双精度下 1e6 × Number('0.0000000028') 不等于精确的 0.0028，
 * 多日累加后 UI 上会出现「用掉了 0.0000000001 pts」这种不存在的尾巴。
 *
 * 产出一律去尾随零（0.0028 而非 0.00280，'10' 而非 '10.0'）。
 */
/** 是否是普通小数串：无符号、无指数、无空白。 */
export declare function isDecimalString(value: unknown): value is string;
export declare function normalizeDecimal(raw: string): string;
/** tokens × 每 token 单价。任一输入非法 → null（不返回 NaN/0 冒充值）。 */
export declare function estimateCost(tokens: number, pricePerToken: string | null | undefined): string | null;
/** 字符串价格 × 整数倍数；倍数必须是安全整数。 */
export declare function mulDecimalByInt(price: string, factor: number): string;
/** 两个十进制串相乘，截断到 places 位小数（不四舍五入，避免把截断尾巴显示成真实用量）。 */
export declare function mulDecimalTruncated(a: string, b: string, places: number): string | null;
//# sourceMappingURL=decimal.d.ts.map