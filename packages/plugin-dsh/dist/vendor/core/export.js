import { scrubSecrets } from './secret.js';
/** 把一次看板应答序列化为可写出的 JSON 字符串，并在写出前清洗秘密。 */
export function exportDashboard(reading) {
    const raw = JSON.stringify(reading, null, 2);
    return scrubSecrets(raw);
}
/** 把一组 MetricsEvent 导出为脱敏 JSON（供导出按钮调用）。 */
export function exportEvents(events) {
    const raw = JSON.stringify(events, null, 2);
    return scrubSecrets(raw);
}
//# sourceMappingURL=export.js.map