import { describe, expect, it } from 'vitest'
import { maskKey, scrubSecrets } from '../src/secret.js'

import { exportDashboard, exportEvents, type DashboardReading, type MetricsEvent } from '../src/index.js'

const NOW = Date.UTC(2026, 10, 19, 2, 0, 0)

function eventWithKey(keyIdMasked: string): MetricsEvent {
  return {
    ts: NOW,
    providerId: 'amd',
    accountAlias: 'acct-a',
    keyIdMasked,
    modelId: 'DeepSeek-V4-Flash',
    requestId: 'req-1',
    status: 200,
    latencyMs: 120,
    attempt: 1,
  }
}

describe('U-05 脱敏导出', () => {
  it('看板导出 JSON 不含完整 Key，keyIdMasked 被清洗', () => {
    const reading: DashboardReading = {
      trend: [],
      rows: [
        eventWithKey('rc-abcd1234efgh5678'),
        eventWithKey('sk-ijkl9012mnop3456'),
      ],
      concurrency: [],
      heat: [],
    }
    const out = exportDashboard(reading)
    // 原始完整串不得出现在导出里：
    expect(out).not.toContain('rc-abcd1234efgh5678')
    expect(out).not.toContain('sk-ijkl9012mnop3456')
    // scrubSecrets 把完整 Key 压成 <prefix>…：
    expect(out).toContain('rc-…')
    expect(out).toContain('sk-…')
    // 无未掩码的密钥前缀后面跟长串：
    expect(out).not.toMatch(/(rc-|sk-|cpk-|nvapi-|AIza)[A-Za-z0-9_-]{8,}/)
  })

  it('事件导出 JSON 不含完整 Key', () => {
    const events: MetricsEvent[] = [
      eventWithKey('rc-abcd1234efgh5678'),
      eventWithKey('cpk-mnop3456qrst7890'),
    ]
    const out = exportEvents(events)
    expect(out).not.toContain('rc-abcd1234efgh5678')
    expect(out).not.toContain('cpk-mnop3456qrst7890')
    expect(out).toContain('rc-…')
    expect(out).toContain('cpk-…')
  })

  it('scrubSecrets 压缩任何泄漏的完整 Key', () => {
    // 就算 MetricsEvent 里 somehow 放进了完整 Key，导出时也会被 scrubSecrets 清洗：
    const leaked = JSON.stringify({ key: 'rc-leakedkey1234567890' })
    const cleaned = scrubSecrets(leaked)
    expect(cleaned).not.toContain('rc-leakedkey1234567890')
    expect(cleaned).toContain('rc-…')
  })
})
