/**
 * 看板导出（U-05：脱敏导出）。
 *
 * 导出 JSON 包含全时段、全板块的看板数据：trend（每分钟分桶）、rows（明细表）、
 * concurrency（并发折线）、heat（队列热力）。导出前对整个 JSON 字符串做一次
 * scrubSecrets，确保任何残留的完整 Key（rc- / sk- / cpk- / nvapi- / AIza 前缀）都被
 * 压成 `<prefix>…`。keyIdMasked 本身已经是掩码后的值（首4+…+末4），末4位可见。
 */
import type { DashboardReading } from './reading.js';
import type { MetricsEvent } from './contract.js';
/** 把一次看板应答序列化为可写出的 JSON 字符串，并在写出前清洗秘密。 */
export declare function exportDashboard(reading: DashboardReading): string;
/** 把一组 MetricsEvent 导出为脱敏 JSON（供导出按钮调用）。 */
export declare function exportEvents(events: readonly MetricsEvent[]): string;
//# sourceMappingURL=export.d.ts.map