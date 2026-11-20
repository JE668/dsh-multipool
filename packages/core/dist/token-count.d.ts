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
    readonly value: number | null;
    /** 上游原文串，UI 原样展示。 */
    readonly raw: string;
    /** true = 单位有歧义，UI 必须带 ? 角标且禁止参与比较/排序/聚合。 */
    readonly ambiguous: boolean;
}
export declare function parseTokenCount(input: unknown): TokenCount | null;
//# sourceMappingURL=token-count.d.ts.map