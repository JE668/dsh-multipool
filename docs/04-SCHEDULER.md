# 04 · SCHEDULER（限流调度与 429 防护）

> 本文件是整个插件的核心算法层。目标：**在请求发出「前」把 429 的概率压到最低**，同时**不牺牲缓存命中**。
> 关键前提（D2 一号一 Key）：四个 Provider 都按「账号」计量，因此**每个 Account = 一个配额桶**，能力可叠加。

---

## 1. 设计纲领：三道闸 + 一个灰区

每个出站请求按顺序过三道闸，**任何一道不通过就排队，不发给上游**：

```
DSH 请求
  │
  ├─ 闸 1  Provider 预算闸（Budget Gate）   每账号 per-provider RPM/并发预判
  │         └─ 不通过 → 排队等待该桶释放（可见「排队中」）
  │
  ├─ 闸 2  Key 选择闸（Account Select）      在候选账号中挑「粘性优先 + 负载最低」
  │         └─ 无可用账号 → 503 本地错误（不伪造 429）
  │
  ├─ 闸 3  熔断闸（Breaker Gate）            该 (account, model) 近窗 429 率过高则短路
  │         └─ 短路 → 直接走闸 2 换桶，不再探原桶
  │
  └─ 发出 → 响应分类 → 更新桶（成功/429/额度/网络）
```

**灰区**（官方建议反而值得遵守）：AMD 官方明确要求「**按 Retry-After 等待，不要自己设定间隔**」。所以对 AMD：

- 闸 1 只在「**剩余额度 < 本桶预算**」时排队（预算是 `min(20, 响应头给的 limit) × 安全系数`）；
- 一旦收到 429，闸 18 的退避**严格以 `Retry-After` 为基准**，不自己发明等待秒数，只额外加抖动（避免同刻齐射，这正是官方提醒的「大家都卡在 60 秒」问题）。

对其他三家（NIM / SenseNova / Agnes）：没有可靠的 Retry-After 语义，闸 1 的本地预算闸是**唯一**防线，必须更保守。

---

## 2. 闸 1：每账号预算

### 2.1 预算定义

```ts
interface Budget {
  accountAlias: string;
  providerId: ProviderId;
  rpmLimit: number;          // 账号级 RPM 上限（profile 推导）
  rpmWindowMs: 60_000;
  concurrencyLimit: number;  // 账号级并发上限
  dailyQuota?: number;       // AMD: pts；SenseNova: 积分以池计；Agnes: 请求数/credits
  dailyWindowTz: 'Asia/Shanghai';
}
```

### 2.2 各 Provider 初始预算（启动即用，全部可配置）

| Provider | rpmLimit | 依据 | concurrencyLimit | 依据 | 备注 |
|---|---|---|---|---|---|
| **AMD** | **20 账号** / **30 单 Key** | 两张官方表并列 | **6**（官方 8 × 0.75） | 官方 8 是硬帽，调度器内留缓冲 | 闸 1 先看账号 20，再看 Key 30；两者都过 |
| **NIM** | **40**（用户确认） | user | **6**（假设） | assume | `/v1/models` 响应头可能带余量，有则以它为准 |
| **SenseNova** | **3 起步，自适应上调** | assume | **4**（假设） | assume | 不撞墙不上调；Speed 曲线见 §3 |
| **Agnes** | **20**（免费档） | doc（code.md 对免费用户列 20 RPM） | **8**（假设） | assume | 402 = 额度；429 = RPM |

> SenseNova 的 **3 RPM 非常低**：若你的真实用量远超此数，插件会**持续排队**。必须告诉用户：
> 「SenseNova 用的是**探索模式**，初始预算为 3 RPM，运行中会按 §3 逐步上调。若排队超过 10 秒，你可以手动把预算改为 10，代价是可能遭遇一次 429。」

### 2.3 闸 1 算法（令牌桶 / 滑动窗口）

AMDa 用 **60 秒滑动窗口计数**（因为官方说「60 秒滑动窗口」）；其他三家同理，窗口均为 60 秒。

```
tryAcquire(account, est):
  1. window = 过去 60s 内到达本账号的请求时间戳（含失败）
     注意：排队中的请求「放行时」才入窗，不是「到达时」入窗
  2. if window.size >= rpmLimit:
        waitUntil = window[0] + 60_000
        return { ok: false, retryAfter: waitUntil - now }
  3. if inFlight >= concurrencyLimit:
        return { ok: false, waitForSlot: true }
  4. if dailyQuota !== undefined and dailyUsed + estimateCost(est) >= dailyQuota:
        return { ok: false, reason: 'quota_exhausted', resetAt: dailyResetAt }
  5. 入窗；返回 { ok: true, budget: {...} }
```

**估算成本**：拿到响应后才能算精确 cost（`usage` 里的 token），因此闸 1 用「输入 token × prompt 单价 + max_tokens × completion 单价 × 0.5」保守估计；响应后按真实 `usage` 修正 `dailyUsed`。**修正值不追补回已放行的请求**，只影响后续判断（简单一致，不引入回滚振荡）。

### 2.4 闸 1 的 429 对照组（这是你之前频繁 429 的主因）

如果你（或你之前用的方案）在**多开账号**里碰到 `Gate 1 预算 20` 和 `Key 级 30` **两把尺子同时**硬限 20 —— 一旦**多个 Key 其实来自同一个账号**（例如同账号轮换 Key），`20 RPM × 账号数` 的假设就**错 ×倍数**，你的限流会「过度乐观」，多出的请求全部撞 429。

反之，如果你**只按单 Key 20 设闸、没做跨账号叠加**，在多账号情况下会「过度保守」：明明 3 个账号各自能跑 20 RPM（合计 60 RPM 的上游额度），你却只跑到 20，项目自然更慢。

> 注意两种「40 RPM」陷阱都无出处，不得据此设闸：① 把 20 与 30 相加得 40；② 把账号 20 与 Key 30 分别放行得 30（超过网关账号 20 必然 429）。单账号准入预算按 ADR-10 取 `floor(min(20, 30) * 0.85 / 1.5) = 11`，`0.85`/`1.5` 是本文件的系数而非上游声明。

→ **这正是为什么必须做「账号汇总诊断」**（见 `06-TASKS.md` T-1-i）：让用户在设置页一键看到「当前假设的总容量 = N × 20 RPM」是否与实际情况（同账号多 Key）一致。

---

## 3. 闸 2：Key 选择（粘性优先 + 最小负载）

### 3.1 选择顺序

```
候选 = accounts where
       status == 'available'
   AND (rateKind 对当前 model 无阻塞: 403 model 级不可用 / model_missing 的门分别过滤)
   AND budget.tryAcquire → ok

if 候选为空:
    如果 全部候选都在「短等」窗口内(≤ maxWaitMs):
        排队等待最早可用的那一个（闸内排队，不返回 429）
    否则:
        返回 503 { code:'dsh_multipool_saturated', retryAfterMs }

selected = stickyPick(session, candidates) ?? leastLoad(candidates)
```

### 3.2 粘性规则（保住 prefix cache）

```
stickyPick(session, candidates):
  e = bindings.get(session.id)
  if e and e.keyId in candidates and now - e.boundAt < T_STICKY_IDLE:
      return e.account            // 同会话绝不无谓换桶
  return null
```

会话**绑定**（首次成功发请求即绑定），**解绑/迁移**条件只有三条：

1. 绑定账号 UNHEALTHY（429/5xx 连续）且 **迁移代价评估** 显示迁移比等待便宜（见 3.4）；
2. 绑定账号 **额度/时钟** 不够本会话继续（如配额已耗尽到窗口边界，等待到边界 > 迁移阈值）；
3. 会话空闲超过 `T_STICKY_IDLE`（那就不叫「切换」了，缓存本就冷）。

> 关键**反直觉**结论：**429 时先不迁，等 `Retry-After` 比迁更省积分**。因为迁 = 前缀缓存必然全丢（唯一例外：同一账号的同一 model 且有共享缓存——DSH 侧不保证，所以一律按丢算）。

### 3.3 `leastLoad` 打分

```
score(a) = rpm_used(a)/rpmLimit(a) * 1.0
         + inFlight(a)/concurrencyLimit(a) * 0.6
         + (a.dailyQuota !== undefined ? dailyUsedRatio(a) : 0) * 0.2
         + (a.lastMigratedRecently(session) ? 0.3 : 0)
         - (a.lastSuccessAt 近 60s ? 0.05 : 0)   // 轻微偏好热账号
```

权重全部可配置。`leastLoad` 只在「新会话」或「必须迁移」时起作用，**session 已绑定时不重算**（一旦每次请求都重算就是变相轮询，前缀缓存全部报废）。

### 3.4 迁移代价评估 `shouldMigrate`

```
costWrong(bucket) = prefixCacheWorth(savedTokens × input_cache_read_price)  // 估价/近似
costStay(bucket)  = Retry-After 或 冷却边界 的等待时间 × 用户容忍度权重
shouldMigrate = costStay > costWrong * MIGRATION_BIAS || 会话已接近 maxTurns 且 bucket 将耗尽
```

`MIGRATION_BIAS` 默认 **3.0**（宁可等 3 倍时间也不迁）。理由：AMD `input_cache_read` 价格仅为 `prompt` 的 **1/50**（0.0000000028 vs 0.00000014，见 02 §1.5），**缓存命中可省 98% 输入侧成本**；迁一次丢一次前缀，代价极高。这个系数直接来自官方定价表，不是玄学。

> 对没有折扣价 / 没有缓存定价的 Provider（NIM、SenseNova、Agnes 缓存价可能是 0 或未知），这个公式的 `costWrong` 退化成「省不了钱但能省延迟和 context 重传」，`MIGRATION_BIAS` 相应下调（默认 1.0）。

---

## 4. 闸 3：熔断

按 `(providerId, accountAlias, modelId)` 维护近 N 次结果的 429 率：

```
breaker:
  window = 最近 20 次（或最近 5 分钟，取较大覆盖）
  trip  = err429Count / total > 0.5    → open（短路）
  half  = open 持续 30s 或有 1 次外部成功  → half-open（放 1 个探测）
  close = half-open 探测成功 → close
```

- 熔断打开时，**该账号不再被 leastLoad 选中**，会话如已绑定则触发 `shouldMigrate`（`costStay` 视为 ∞）。
- 熔断只针对「模型级」；同账号换 model 不受影响（AMD 的 model 并发限额是模型级的，官方明说「每个模型的话取决于该模型后端能承受的并发」）。
- SenseNova 的 `quota_exceeded_error` 不可归因（见 02 §3.4），**用升速/降速代替熔断**，不做 model 级 open。

---

## 5. 响应处理与退避（收到后 → 更新桶）

### 5.1 分类 → 动作表

| `RateClass` | AMD | NIM | SenseNova | Agnes | 动作 |
|---|---|---|---|---|---|
| `ok` | 2xx | 2xx | 2xx | 2xx | 记用量、清连续失败计数、**允许升速**（§6） |
| `rpm_key` | `token_rate_limit_exceeded` | 429（本地判断） | `{code:429}` | 429（RPM 原因） | Key 窗口保持，等待 `Retry-After`，**不迁**，不降速 |
| `rpm_ip` | `ip_rate_limit_exceeded` | — | — | — | **该出口 IP 下所有 Key 全停**至 `Retry-After`，立刻考虑迁 Provider |
| `concurrency` | `*_concurrency_*` | 本地 inFlight 满 | — | 429（并发原因） | 只等 `Retry-After`(1) 或本地槽位释放，**绝不降 RPM** |
| `daily_quota` | 网关 message `Daily usage limit exceeded` | — | 429 `quota_exceeded_error`（**仅当疑似额度**） | **402** `Payment Required` | 等到重置边界（或 5h 边界），**做迁移**，并在 UI 标红 |
| `rate_opaque` | — | — | 429 `quota_exceeded_error`（**主判据**） | — | **降速 ×0.5** + 指数退避（30s 起，上限 300s）；连续 3 次 429 后再迁移 |
| `auth` | 401/403 | 401/403 | `{code:16}` 403 | 401 / 403（模型无权限） | **不自动恢复**，Key 标 `auth_failed`，等人工；401≠402 要分开 |
| `model_missing` | 400 `Requested model ... not supported` | 404 | 404 | 404 | 刷新模型目录；不冷却 Key |
| `network` | 超时 / DNS / 连接重置 | 同 | 同 | 同 | 短退避重试（同账号），不迁、不降速 |
| `upstream_5xx` | 5xx | 5xx | 5xx | 5xx | 指数退避 + 抖动，同账号优先；连续则迁移 |
| `client_4xx` | 400（非 model 错） | 400 | 400 | 400 | 不重试；把错误原样回给 DSH |

### 5.2 无响应头时的退避（默认策略）

```
wait(attempt) = min(base * 2^attempt, cap) * (1 + jitterRandom(0, 0.3))
```

| Provider | base | cap |
|---|---|---|
| AMD（无 Retry-After） | 60s | 300s |
| Agnes | 60s | 300s |
| NIM | 5s | 60s |
| SenseNova | 30s | 300s |

- 有 `Retry-After` 时 **`wait = Retry-After * (1 + jitter(0, 0.15))`**（AMD 官方点名的「大家都卡 60 秒整点」问题）。
- `Retry-After` 可能是秒数或 HTTP date，解析器要同时支持。
- 最大尝试次数：**3**（每次插件内重试算一次；超过即向 DSH 返回 429 的包装错误，让上层看到「已被插件保护过」并附上诊断）。

---

## 6. 自适应升速（SenseNova 专用；AMD 专属见 §6.4）

`admitRpm` 是插件"允许发出"的速率，与上游真限的关系有三种可能：等于、低于、高于。三条来源按下表优先级取值，冲突时取小者。

| 优先级 | 来源 | 何时存在 | 冲突处理 |
|---|---|---|---|
| 1 | 上游响应头 `X-RateLimit-Limit-User-RPM` / `-Remaining-User-RPM` | 仅 AMD，且上游确实返回该头 | 见 §6.4，取小 |
| 2 | 用户显式配置（设置页「RPM 上限」） | 用户填过即存在，`source: user` | 取小，并在 UI 标注「配置值大于上游值，已被上游压回」 |
| 3 | 内置默认（`catalog/limits.json`） | 始终存在，作兜底 | — |

优先级 1 压过用户配置的理由：头是上游自己说的，比任何本地数字都权威。优先级 2 压过 3 的理由：内置默认只是保守起点，不是官方底数——SenseNova / NIM / Agnes 的 RPM 从未逐字给出，写死在 catalog 里只能带 `assume` 标签；用户显式填值时由他承担该数字的责任，插件不应拿自己的假设去覆盖他的配置。

唯一例外：用户把该账号的 `autoTune` 显式关掉（设置页「不自动学习」开关），则优先级 1 跳过，头只用于 UI 展示、不参与准入；此状态在浮层与看板上标「手动锁定」黄标。

落地到代码：`packages/core/src/budget.ts` 的 `resolveAdmitRpm(account)` 按上表顺序取值，返回 `{ admitRpm, sources: Sourced[] }`，`sources` 全量交给 UI——让用户看到这个数字从哪来、压过谁，而不是只看到一个 3。

### 6.1 为什么不用 AIMD 全速试探

最直接的原因：429 的代价不是等一秒，而是丢掉整个 prompt cache。

DSH 的 agent 请求是长前缀——系统提示词 + 工具定义 + 历史对话，动辄几千上万 token 稳定在头部。AMD / SenseNova 的 prefix caching 按"相同前缀命中"折价（AMD 的 `input_cache_read` 单价只有 prompt 的约 1/50）。一旦 429，`wait(attempt)` 起步就是 30~60 秒，这期间：

1. 缓存条目按 TTL 过期（AMD 侧不公开 TTL，业界普遍 5~15 分钟，60 秒等待已经吃掉可观比例）；
2. 就算没过期，重试时若换了 Key 或账号，前缀缓存直接落空——缓存是账号 / Key 维度隔离的。

所以"拿 429 当保真度信号、全速往上试"的课本式 AIMD 在这里是负收益：为了搏一个 +25% 的速率，付出一次 cache miss 重算全前缀的积分（长上下文下远大于被限流的那些请求本身）。

### 6.2 AIMD 在本项目的三条约束合同

1. 只在完全无前验信号的维度上探：SenseNova 的 RPM 官方从未给出，才用 AIMD；AMD / NIM / Agnes 的 RPM 有 doc 或 user 标签，只做"保守系数 + 头校准 + 头缺失时保持"，不探。
2. 只升、不拿 429 来降：429 的责任交给 §5.1 的分类表和冷却，AIMD 只负责"冷却期结束后一点点把额度捡回来"。这样即使分类错了，也不会出现"AIMD 猛降 + 冷却超长"的乘法叠加。
3. 升降幅度都是对数的、频率都是十分钟级的：×1.25 / ×0.5 配 10 分钟窗口，意味着从 3 追到 30 约需 1 小时、从 30 压回 3 约需 40 分钟，特意做得比人的耐心慢，使它不该成为 429 的主要成因。

### 6.3 探针的使用边界

不主动发探针（02 §6 非目标第 2 条）。唯一的"探"是 T-1-i 的账号汇总诊断：只读按钮、60 秒内最多一次、结果只进 UI 不参与准入。

理由与 02 §6 一致：探针本身也计入 RPM 与积分，且 `max_tokens: 1` 只能验请求数桶，不能验大请求的 TPM 桶——用探针判断"恢复了没有"会得到一个偏乐观的假信号。

### 6.4 前验信号校准（AMD 专属）

如果上游响应头里有 `X-RateLimit-Remaining-User-RPM`：

```
admitRpm = min(当前预算, 剩余次数 + 本窗口已用)   // 用响应头校准窗口内余量
```

这只是**校准**，不是替代。头缺失（502、网络错误等）时保持原预算。

---

## 7. 并发与多进程

DSH 插件 Host 侧可能只有一个进程，但用户会**多开 DSH 窗口/多开 agent** 共享同一个账号。插件必须假设：

- 上游账号级 20 RPM 是**所有进程共享**的，而我们本地只看到自己的请求；
- → 闸 1 预算除以 `assumedExternalClients`（默认 **1.5**），即「假设还有 \~33% 的并发流量来自插件之外」，至少 1（若你确认只有 DSH 用该账号，可在设置里改 1）。
- 若需要严格跨进程共享（多个 DSH 实例），可写一个 **单机文件锁 + 共享窗口文件** 的可选实现：`~/.dsh-multipool/windows/<provider>/<account>.json`，60 秒窗口槽用 `fcntl.flock` 原子更新。默认**关闭**（D2 一号一 Key 下，主要风险是「同账号在别处也开了一个 DSH」，进阶需求）。

---

## 8. 已知错误/教训（源自项目史与已核实的官方文档）

| 教训 | 出处 | 后果 | 现在的做法 |
|---|---|---|---|
| 把「滚动周期」当官方原文 | 我 batch 2 条检索摘要直接引用 | 日额度重置时间判断错 | **纠正**：AMD 为北京时间自然日 00:00 重置（官方两页原文一致） |
| 把 `/v1/usage` 的 `rpm_limit` 当「**账号**级 20」 | 自己推断 | 以为单 Key 可以跑 20 → 实际会触发平台层 30 才卡，网关层 20 更早 | `rpm_limit` 是**本 API Key 上限**，值 30；账号级是网关 20，两个都要限（§2.2） |
| 以为 `/v1/usage` 不消耗 RPM | 第三方 README 转述 | 高频轮询反而造 429 | **官方文档没说它不计**。默认 5 分钟轮询、手动刷新、不因看板刷新调（03 §8） |
| 把 NIM 的 `40 RPM` 当官方文档值 | 搜到第三方教程 | 若 NIM 实际不是 40，启动就撞墙 | 用户口述确认，作 `configuredRpm`（`source:'user'`）；2026-11-17 两页官方 Reference 抓取均未给出该数字，故在 docs/02 §2.2 以**否定性结论**保留（「官方未逐字给出」），不参与准入推导，也不据此回改用户给值 |
| 认为 SenseNova 有 RPM 数值 | 以为公开文档必有 | 做「前验预算」必定穿帮 | 三份资料全文 0 命中；改为 `rate_opaque` 降速方案，禁用 RPM 预判 |
| 认为 `quota_exceeded_error` 可以细分 | 名字暗示分开 | 把「速率」误当「额度」冷却 24h | 同一个 code，不可区分 → 降速为主、迁移为辅（§6；docs/02 §3.4） |
| 以为所有 Provider 都有 usage 端点 | 通用假设 | SenseNova/NIM 一直显示「未知」看着像 bug | 无端点即显式 `no-endpoint`，UI 文案写清楚 |
| 以为模型对象都长 OpenAI 样子 | 常识惯性 | 读 `object`/`owned_by`/`created` 全是 undefined | AMD 字段表逐字写进 02 §1.5；NIM/SenseNova/Agnes 各写各的解析器 |
| 只看 `code` 判 429 | 贪快 | AMD 平台层 code 在 `detail` 里，网关层 code 相同 | 只看 `status` + `Retry-After`，code 仅归类 |
| 假设所有供应商都返回 `Retry-After` | 天真 | SenseNova 没写、Agnes 没写 → 退避无依据 | 有则用、无则本地曲线 |
| 假设跨 Provider 迁移是安全的 | 想省事 | 供应商可能把同一请求在极短时间内出现在多个账户视为整池异常 | 跨 Provider 默认关闭 |
| 把 `65.5K` 当 65500 | 想当然 | 实际可能是 65536 或 67072 | `ambiguous=true`，原文保留 |
| 把敏感矩阵 `pre-alpha` 当稳定模型 | 贪新 | 预览版随时下线/改名 | `comingSoon`/`unknown` 显式标注（02 §5） |

---

## 9. 调度器测试矩阵（必测，对应 07-ACCEPTANCE）

| 编号 | 场景 | 期望 |
|---|---|---|
| S-01 | AMD 单账号，每 6 秒发 10 次（= ~10 RPM） | 全部成功，无排队 |
| S-02 | AMD 单账号，3 秒内发 20 次 | 前 20 次内**不出现**上游 429；多余请求在插件内排队；总耗时接近 60s |
| S-03 | AMD 双账号，3 秒内发 40 次 | 两账号各分约 20；**不出现**上游 429；插件内排队 |
| S-04 | AMD 双账号，3 秒内发 50 次 | 前 40 快速过，后 10 排队；**仍不出现**上游 429（允许 latency 高） |
| S-05 | 模拟上游对单 Key 提前 30 RPS 返 429 | 该 Key 进入冷却 60s±15%；**其他 Key 不受影响** |
| S-06 | 模拟上游返 `ip_rate_limit_exceeded` | **同出口 IP 全部 Key** 冷却 60s；不同 IP Key 不受影响 |
| S-07 | 会话 A 已绑定 Key-1，Key-1 429 但 Key-2 空闲 | **A 仍等 Key-1**（除非 Retry-After > migrateThreshold）；迁移计数不变 |
| S-08  persists | 会话 A 已绑定 Key-1，Key-1 返回 `daily_quota`（Retry-After 到 reset） | A **迁到** Key-2；日志记录迁移原因 |
| S-09 | SenseNova 429 | 冷却 30s 起、×2 递增、封顶 300s、带抖动；**降速 ×0.5**；第 3 次才迁移 |
| S-10 | Agnes 429 | 冷却 60s±；**不**把 Key 标额度耗尽 |
| S-11 | Agnes 402 | 直接走 `plan_credit`，冷却至 5h 边界，标额度；**不**等 429 曲线 |
| S-12 | Agnes 403（某 model） | 该 model 对该 Key 标不可用；RPM 预算**不变**；换 model 可成功 |
| S-13 | SenseNova `{code:16}` | 视为 `auth`，**不**重试、**不**降速、需人工 |
| S-14 | NIM 429 无 `Retry-After` | 5s→10s→20s→40s→60s 封顶，抖动 ±30% |
| S-15 | NIM 有 `X-RateLimit-*` 头 | 预算被头部校准（剩余更小则取小） |
| S-16 | 429 后同会话重试成功（同账号） | 该 (account,model) 熔断计数增加；不迁移会话 |
| S-17 | 连续 3 次 429（不同请求） | 熔断打开；会话迁移 |
| S-18 | 断网恢复 | 进入 `network` 短退避，恢复后**不**因失败次数多而一刀切锁死 |
| S-19 | 30 天保留边界 | 第 31 天的 `MetricsEvent` 被清，`DailyRollup` 仍在 |
| S-20 | 同时 5 个会话，2 个账号 | 粘性分散 ≈ 2:3，且**不因新会话出现而抖动老会话绑定** |
