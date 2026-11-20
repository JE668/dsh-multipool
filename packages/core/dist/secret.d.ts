/**
 * Key 脱敏与日志清洗（docs/03 §7、docs/02 §1.5、docs/07 U-04）
 *
 * 铁律：插件写出的任何日志 / 导出文件 / 错误报告里都不允许出现完整 Key。
 * 一次清洗要同时做两件事——
 *   1. maskKey: 已知前缀的 Key → `<prefix>…<last4>`，用于 UI 回显；
 *   2. scrubSecrets: 任意文本 → 把所有 (cpk-|rc-|sk-|nvapi-|AIza)[A-Za-z0-9_-]{8,} 压成 `<prefix>…`，
 *      用于日志与错误串。两者都必须在**写出去之前**调用，不能事后补。
 */
/** 缺失值统一占位：不是 0、不是 ""、不是掩码后的 Key（03 §3.2）。 */
export declare const UNKNOWN_PLACEHOLDER = "(\u4E0A\u6E38\u672A\u63D0\u4F9B)";
export declare function maskKey(key: string | null | undefined): string;
export declare function scrubSecrets(input: string | null | undefined): string;
//# sourceMappingURL=secret.d.ts.map