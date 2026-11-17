# 03 · DATA CONTRACT（统一数据模型与字段来源）

> 本文件定义插件内部**唯一**的数据形状。UI、调度器、存储、看板都只消费这里的类型。
> 原则：**来源随值走**（每个值携带 `source`）；**缺失即 null，不是 0**；**原文永不丢**。

---

## 1. 来源枚举 `Source`

```ts
export type Source =
  | 'api'          // 端点运行时返回（最高可信度，可覆盖其他）
  | 'doc'          // 官方在线文档原文（已逐字核对，附 URL + 抓取日期）
  | 'doc-local'    // 用户本机资料文件原文（附文件名 + 行号 + 整理日期）
  | 'learned'      // 插件后验学习（AIMD / 429 统计），附样本数与更新时间
  | 'user'         // 用户在设置面板显式填写/确认
  | 'assume'       // 保守假设，必须在 UI 标「假设/待校准」
  | 'unknown';     // 无任何来源
```

**优先级（冲突时用于选「准入判断用哪个值」）**：`api` > `doc` > `doc-local` > `user` > `learned` > `assume` > `unknown`

> 优先级只决定「拿哪个数去算准入」。**展示时仍按铁律 3 并排显示所有来源值**，除非该冲突已被 `resolvedConflicts` 人工裁定。

---

## 2. 带来源的标量 `Sourced<T>`

```ts
export interface Sourced<T = unknown> {
  value: T | null;          // null 合法，代表「有来源但没有值」
  source: Source;
  ref?: string;             // doc: URL；doc-local: '文件名:行号'；user/assume: 'YYYY-MM-DD 决策记录'；learned: '样本数/窗口'
  note?: string;            // 口径说明、冲突说明
  ambiguous?: boolean;      // 单位不可判定时为 true（如 '65.5K'）
  raw?: string;             // 端点/文档原文串，永不丢
  fetchedAt?: string;       // ISO 8601
}
```

**硬性规则**

- 上游没有的字段，一律是 `{ value: null, source: 'unknown' }`，**不是 `0`、不是 `''`、不是 `-1`**。
- 渲染层对 `source==='unknown'` 只能输出 `(上游未提供)` 或 `(本地估算)`，且**不可排序、不进图表、不参与聚合**。
- `raw` 必须保留原文。解析器可以在 `value` 上做归一化，但 `raw` 永远不被覆盖。

---

## 3. 核心实体

### 3.1 `ProviderId`

```ts
type ProviderId = 'amd' | 'nim' | 'sensenova' | 'agnes';
```

### 3.2 `Account`

「账号」是**计量单位**，不是「Key」。D1 约定一号一 Key。

```ts
interface Account {
  providerId: ProviderId;
  accountAlias: string;       // 用户填写的人类可读别名，如 'AMD-A'
  keyIdMasked: string;        // 末 4 位，如 'rc-…1a2b'
  enabled: boolean;
  limits: {                   // 账号级限额画像
    rpmAccount?: Sourced<number>;
    dailyQuota?: Sourced<number>;
    planTier?: Sourced<AgnesTier>;
  };
  status: AccountStatus;
  coolUntil?: number;         // ms epoch；status 为 rate_limited/quota_exhausted 时有值
  cooldownReason?: RateKind;
  lastSeenAt?: string;
}

type AccountStatus =
  | 'available'
  | 'rate_limited'   // 短时冷却中（RPM 类）
  | 'quota_exhausted'// 额度用尽（等到窗口/自然日边界）
  | 'quota_unknown'  // 无用量端点（SenseNova/NIM/Agnes 可能）
  | 'auth_failed'    // 凭证失效（不自动恢复，需人工）
  | 'disabled'       // 用户手动停用
  | 'rejected_key';  // 形似 sk- / 实例域名被拒，不可参与调度
```

### 3.3 `NormalizedModel`（统一模型）

```ts
interface NormalizedModel {
  providerId: ProviderId;
  id: string;                              // source: 'api'（必须）
  displayName?: string;                    // AMD: name；其余: id
  family?: Sourced<string>;

  // 规格
  contextLength?: Sourced<number>;         // token 数；原文带 K/M 时 raw 保存原文
  maxOutput?: Sourced<number>;

  // 能力
  inputModalities?: Sourced<Modality[]>;
  outputModalities?: Sourced<Modality[]>;
  supportedParameters?: Sourced<string[]>; // AMD 专有
  capabilities?: {
    tools?: Sourced<boolean>;
    vision?: Sourced<boolean>;
    reasoning?: Sourced<boolean>;
    jsonMode?: Sourced<boolean>;
    structuredOutputs?: Sourced<boolean>;
  };
  reasoningLevels?: Sourced<string[]> | null; // 四家 /v1/models 均未提供 → unknown

  // 价格（全是字符串；保留原文，不转 float）
  pricing?: {
    prompt?: Sourced<string>;
    completion?: Sourced<string>;
    inputCacheRead?: Sourced<string>;
    perCharPrompt?: Sourced<string>;        // AMD OmniVoice 类：按字符计价
  } | null;

  stability?: Sourced<'stable' | 'beta' | 'unstable' | 'experimental'>;
  free?: Sourced<boolean>;                 // 仅 AMD；语义见 02 §1.7（≠ 免费）

  // 冲突与来源
  conflicts?: Array<{
    field: string;
    values: Array<{ value: unknown; source: Source; ref?: string }>;
    resolved?: { value: unknown; by: 'api' | 'user' | 'manual'; ref: string };
  }>;

  fetchedAt: string;
  staleSince?: string;                     // 刷新失败时保留旧值的时间点
  catalogSource?: 'api' | 'bundled' | 'merged';
}
```

**先例**：SenseNova 6.8 曾出现 `api` 给的 `context_length: 262144` 与本地资料表写「1M」不一致。用户裁定 262144 正确（见 `catalog/limits.json` 的 `resolvedConflicts`）。解析器仍需保留通用冲突机制，以便应对同类问题。

### 3.4 `MetricsEvent`（看板专用轻量事件）

写入 30 天的记录**不保存**完整请求 text，只保存可聚合字段，降低泄露面与体积：

```ts
interface MetricsEvent {
  ts: number;                       // ms epoch
  providerId: ProviderId;
  accountAlias: string;
  keyIdMasked: string;
  modelId: string;
  requestId: string;
  status: number;
  latencyMs: number;
  attempt: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  rateKind?: RateKind;
  queueWaitMs?: number;
  concurrencyAtSend: number;
}

interface DailyRollup {
  date: string;            // 'YYYY-MM-DD'，按 Asia/Shanghai 分日（与 AMD 口径一致）
  providerId: ProviderId;
  accountAlias: string;
  modelId?: string;
  requests: number;
  errors: number;
  err429: Partial<Record<RateKind, number>>;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  estimatedCostPts: number | null;
}
```

---

## 4. `RateKind`（429 分类）

```ts
type RateKind =
  | 'rpm_key'        // AMD 平台层：每 Key 30 RPM（RT=60）
  | 'rpm_ip'         // AMD 平台层：每 IP 120 RPM（RT=60）；同出口 IP 的全部账号共享
  | 'concurrency'    // AMD 平台层：并发 1..8（RT=1）；Agnes 并发过多（429）；NIM 本地并发满
  | 'daily_quota'    // AMD 网关层：每日 pts 上限（RT=周期剩余秒数）
  | 'plan_credit'    // Agnes：402 套餐/余额不足（不是 429）
  | 'rate_opaque'    // SenseNova：quota_exceeded_error，不可归因
  | 'auth'           // 401/403：凭证或权限（不是限流）
  | 'model_missing'; // 400 'Requested model ... not supported'（AMD）/ 404（其他）
```

| Kind | Provider | 触发判据 | 冷却 | 迁移会话 |
|---|---|---|---|---|
| `rpm_key` | AMD | 平台层 `token_rate_limit_exceeded` | `Retry-After`(60) + 抖动 | 否 |
| `rpm_ip` | AMD | 平台层 `ip_rate_limit_exceeded` | `Retry-After`(60) + 抖动，**同出口 IP 全局生效** | 是（换 IP/换 Provider） |
| `concurrency` | AMD / Agnes / NIM | AMD `*_concurrency_*`；Agnes 429 并发原因；NIM 本地预算满 | `Retry-After`(1) 或本地释放即试 | 否 |
| `daily_quota` | AMD | 网关层 message 含 `Daily usage limit exceeded` | 等到 `daily_reset_at` | 是 |
| `plan_credit` | Agnes | **HTTP 402** | 等到当前 5h 窗口边界 | 是 |
| `rate_opaque` | SenseNova | 429 `quota_exceeded_error` | 指数退避 + 降速（×0.5） | 降速优先，连续 N 次后迁移 |
| `auth` | 全部 | 401/403（SenseNova 实测 `{code:16}`） | 人工恢复 | 是 |
| `model_missing` | AMD/其他 | 400 `not supported` / 404 | 刷新目录 | 否 |

**Agnes 403 的特殊处理**：403 = Key 对该模型无权限 / 区域受限 → **不降 RPM 预算、不冷却 Key**，改为「该 (account, model) 组合标不可用」+ 换模型。若全部模型 403 才升级为 `auth`。

---

## 5. 解析器契约（每 Provider 一个）

```ts
interface ProviderAdapter {
  id: ProviderId;
  classify(res: AdapterResponse): RateClass;
  fetchModels(key: string): Promise<ModelCatalogResult>;
  fetchUsage?(key: string): Promise<UsageResult>;
  readHeaders?(res: AdapterResponse): HeaderSnapshot | null;
  backoffPolicy(rc: RateClass, attempt: number): { waitMs: number; jitterMs: number };
}
```

**必须实现的容错**（均有文档/实测依据）：

1. **AMD 三种错误外壳**：顶层 `error`、`detail.error`、Anthropic `{type:'error',error:{type:'rate_limit_error'}}` 都要能取到 message/code。
2. **AMD code 不得作为判限流依据**（官方明说），只做归类。
3. **SenseNova 非标准错误**：`{"error":{"code":16,"message":"Forbidden"}}` 无 `type` → 按数字 code + message 归类，**不能因缺 `type` 抛解析异常**。
4. **Agnes 402 与 429 分开**：402 走 `plan_credit`，429 走 `rpm`/`concurrency`，**永不合并**。
5. **NIM 响应头可能缺失**：`X-RateLimit-*` 出现就用，不出现就纯本地预算，不得报错或阻塞。
6. **模型目录结构差异**：AMD 裸 `{data}`、NIM `{object:'list',data}`、SenseNova `{data}`（OpenRouter 风）、Agnes `{data}`（无规格字段）→ **四个独立解析器**，禁止共用 OpenAI SDK 的 `models.list()`。

---

## 6. 目录快照 `catalog/limits.json`（结构）

```jsonc
{
  "schemaVersion": 1,
  "collectedAt": "2026-11-17T15:00:00+08:00",
  "providers": {
    "amd": {
      "baseUrl": "https://developer.amd.com.cn/radeon/api/v1",
      "keyPrefix": "rc-",
      "limits": {
        "rpmKey":          { "value": 30, "source": "doc", "ref": ".../api/rate-limits/" },
        "rpmAccount":     { "value": 20, "source": "doc", "ref": ".../api/rate-limits/", "note": "60 秒滑动窗口" },
        "rpmIp":          { "value": 120, "source": "doc", "ref": ".../api/rate-limits/", "note": "仅在边缘节点能提供可信客户端地址时生效；条件性" },
        "concurrencyKey": { "value": 8, "source": "doc", "ref": ".../api/rate-limits/" },
        "dailyQuotaPts":  { "value": null, "source": "unknown", "note": "每账号不同，由 /v1/usage 的 daily_cost_limit_usd 运行时给出" },
        "dailyReset":     { "value": "00:00+08:00", "source": "doc", "ref": ".../api/usage/", "note": "北京时间自然日；实现以 daily_reset_at 字段为准" }
      },
      "sharedWindowEndpoints": ["/v1/chat/completions", "/v1/audio/speech", "/v1/systemone"],
      "usageEndpoint": "/v1/usage",
      "usageRefreshMinMs": 60000,
      "usageRefreshDefaultMs": 300000,
      "modelRefreshDefaultMs": 600000,
      "modelsEndpointCountsAgainstRpm": true
    },
    "nim": {
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "limits": {
        "rpm": { "value": 40, "source": "user", "ref": "2026-11-17 用户确认", "note": "官方 API Reference 未逐字给出该数字" }
      },
      "admitRpm": { "value": 34, "source": "assume", "note": "40 × 0.85 保守系数" },
      "usageEndpoint": null,
      "quotaWindows": null
    },
    "sensenova": {
      "baseUrl": "https://token.sensenova.cn/v1",
      "keyPrefix": "sk-",
      "limits": { "rpm": null, "tpm": null, "qps": null, "retryAfter": null },
      "notes": ["三份资料全文检索 0 命中；429 quota_exceeded_error 把速率与额度合并；无用量/余额 API"],
      "quotaPools": [
        { "name": "通用积分池", "window5h": 120000, "windowWeek": 1200000, "source": "doc-local", "ref": "SenseNova-API-文档整理.md:35-44" },
        { "name": "Flash-Lite 专属池", "window5h": 60000, "windowWeek": 600000, "source": "doc-local", "ref": "SenseNova-API-文档整理.md:46-48" }
      ],
      "admitRpm": { "value": 3, "source": "assume", "note": "初始保守；运行后按 429 率 AIMD 调整" },
      "backoff": { "startMs": 30000, "maxMs": 300000, "jitter": true, "decelerateFactor": 0.5 }
    },
    "agnes": {
      "baseUrl": "https://apihub.agnes-ai.com/v1",
      "keyPrefixHint": "sk-",
      "planTier": { "value": "free", "source": "user", "ref": "2026-11-17 用户确认在用免费档" },
      "tiers": { "free": { "textRpm": 20, "source": "doc" } },
      "admitRpm": { "value": 17, "source": "assume", "note": "20 × 0.85" },
      "creditsPerUsd": { "value": 6600, "source": "doc-local", "ref": "Agnes-Provider-Model-配置速查.md" }
    }
  },
  "resolvedConflicts": [
    {
      "providerId": "sensenova",
      "model": "sensenova-6.8-flash",
      "field": "contextLength",
      "chosen": 262144,
      "chosenBy": "user",
      "at": "2026-11-17",
      "rejected": [{ "value": 1048576, "source": "doc-local", "ref": "SenseNova-Provider-Model-配置速查.md（模型参数表）" }],
      "note": "用户确认两个 6.8 模型上下文均为 256K；表格中的 1M 判为笔误，不采用"
      
    },
    {
      "providerId": "sensenova",
      "model": "sensenova-6.8-flash-lite",
      "field": "contextLength",
      "chosen": 262144,
      "chosenBy": "user",
      "at": "2026-11-17",
      "rejected": [{ "value": 1048576, "source": "doc-local", "ref": "同上" }]
    }
  ]
}
```

---

## 7. Key 存储与脱敏

| 项 | 规则 |
|---|---|
| 存储位置 | DSH 插件 settings 命名空间 `dsh-multipool.keys`（不写普通文件、不写 localStorage 明文） |
| 展示 | **默认掩码** `rc-…1a2b` / `sk-…9f8e`；「显示」需点击，10 秒后自动回掩码 |
| 日志 | 只允许后 4 位；全局脱敏正则 `/(rc-|sk-|cpk-)[A-Za-z0-9]{8,}/g → '$1…'` |
| 错误上报 | 不带上游 body 原文；只带 status、`RateKind`、`Retry-After` |
| 看板导出 | 导出前过脱敏函数，并加单测断言「导出内容不含完整 Key」 |
| 复制 | 「复制」复制**完整 Key**，但写审计日志（只记时间与掩码） |

---

## 8. 聚合查询接口（看板只读这一层）

```ts
interface MetricsQuery {
  from: string; to: string;
  granularity: 'minute' | 'hour' | 'day';
  providerIds?: ProviderId[];
  accountAliases?: string[];
  modelIds?: string[];
}

interface MetricsResult {
  kpis: {
    requests: number;
    errors: number;
    err429: number;
    err429Rate: number;
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    estimatedCostPts: number | null;
    estimatedCredits: number | null;
    activeAccounts: number;
    availableAccounts: number;
  };
  series: Array<{
    bucket: string;
    providerId: ProviderId;
    modelId?: string;
    requests: number;
    promptTokens?: number;       // 无数据则字段缺省，不出图画 0
    completionTokens?: number;
    concurrency: number;         // 由请求 start/end 推得
    err429ByKind: Partial<Record<RateKind, number>>;
  }>;
  accountSnapshot: Account[];
  learnedProfiles: Array<{
    providerId: ProviderId;
    accountAlias: string;
    modelId?: string;
    admitRpm: number;
    samples: number;
    lastAdjustedAt: string;
    confidence: 'low' | 'mid' | 'high';
  }>;
}
```

- 缺失字段**缺省而非 0**：折线图遇缺省点断开，禁止用 0 连线（会伪造「那时候用量为 0」的结论）。
- 看板查询**只读本地聚合**，不得为刷新图表去调上游 `/v1/usage`。
- `DailyRollup` 的 `estimatedCostPts` 在无单价来源时为 `null`，聚合时**跳过 null 而非当 0 累加**。
