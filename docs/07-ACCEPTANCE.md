# 07 · ACCEPTANCE（验收夹具与完成定义）

> 每个用例都有 **Given / When / Then**。可再生、无网、假时钟。
> 执行方式：`pnpm test`（单测）+ `pnpm test:e2e`（假上游）。**真上游用例**（标 `[live]`）只在 `scripts/smoke.ts` 里跑，且默认跳过，不得进 CI。
> 命名锚点：任务号见 `06-TASKS.md`；算法见 `04-SCHEDULER.md`；文案规则见 `05-UI.md`。

---

## 0. 夹具基础设施（先做）

| 夹具 | 作用 |
|---|---|
| `FakeUpstream` | 本地 http server，按 Provider 形态返回（含 AMD 三种错误壳、Agnes 402、SenseNova `{code:16}`、NIM 无头）。可编程：第 N 个请求返指定 status/body/headers。 |
| `FakeClock` | 单调 + 墙钟同时可控；所有 `Date.now()` / `setTimeout` 走它（禁裸用）。 |
| `Advance(ms)` | 推进时间并 flush 所有挂起定时器与微任务。 |
| `Recorder` | 记录「插件向上游发了什么、在第几毫秒、带哪个 Key（掩码）」。 |
| `makeCatalog()` | 生成 4 家 × 若干模型的离线目录快照，字段照 02 各节。 |

**所有用例的铁律**：断言的是 **Recorder 里上游收到的请求流**，不是插件内部日志。

---

## A · AMD（调度 / 分类 / 用量 / 模型）

### A-01 账号级 20 RPM 主动闸生效 `[T-1-f]`
**Given** 1 个 AMD 账号（`rpmAccount=20`），`assumedExternalClients=1`（为稳定测试，测试配置里把 1.5 关掉），假时钟。
**When** 在 t=0 一次性提交 30 个请求。
**Then** 上游在 `[0,60s)` 内收到 **恰好 20** 个请求；剩余 10 个在 t=60s 之后发出；**整个过程上游未收到任何一次 429**（FakeUpstream 设成「超 20 就 429」）。

### A-02 预算保守系数生效 `[T-1-f]`
**Given** `assumedExternalClients=1.5`，`rpmAccount=20`。
**When** 30 秒内连续提交 100 个请求。
**Then** 上游在 `[0,60s)` 内收到 **≤ 13** 个（20/1.5≈13.3 向下取整的窗内放行数）；无 429；插件内排队可见（`queueWaitMs>0`）。

### A-03 Key 级 30 与账号级 20 取小 `[T-1-f]`
**Given** 配置 `rpmAccount=20`、`rpmKey=30`；单账号单 Key。
**Then** 实际放行速率上限由 **20** 决定（断言窗口内 ≤ 20/1.5 或 ≤20，依配置）；且不允许出现「按 30 放行」的分支（单测断言 selector 读取的是 `min`）。

### A-04 六种平台 code 全归 `rpm_key`/`rpm_ip`/`concurrency` `[T-1-b]`
**Given** 六条 `429` 响应体，`detail.error.code` 分别为：
`token_rate_limit_exceeded`、`ip_rate_limit_exceeded`、`token_concurrency_rate_limit_exceeded`、`model_concurrency_rate_limit_exceeded`、`process_concurrency_rate_limit_exceeded`、`global_concurrency_rate_limit_exceeded`；`Retry-After` 按官方（RPM 类 60、并发类 1）。
**Then** 分类结果依次为：`rpm_key / rpm_ip / concurrency / concurrency / concurrency / concurrency`；且分类**只依赖 status 与 Retry-After**——把六条的 `code` 全部替换成垃圾字符串重跑，分类结果**必须不变**（02 §1.4「不要只根据 code 判断」）。

### A-05 网关 RPM 429 `[T-1-b]`
**Given** 顶层 `{"error":{...,"code":"rate_limit_exceeded","message":"Rate limit exceeded: maximum 20 requests per minute for this OneClick user. Please try again later."}}`，`Retry-After: 60`。
**Then** 分类 `rpm_key`（账号级窗口）；冷却 = `60 × (1+U(0,0.15))`；**不**降 RPM 预算；**不**冷却 Key 到次日；UI 侧类别「网关 RPM」。

### A-06 日额度耗尽 `[T-1-b]`
**Given** 网关层 429，message 含 `Daily usage limit exceeded: maximum $10 per period for this OneClick user.`（`$10` 为上游 message 原文，不是货币符号，UI 不得据此显示美元），`Retry-After: 34200`。
**Then** 分类 `daily_quota`；账号状态 `quota_exhausted`；`coolUntil = now + 34200s`，且与 `/v1/usage` 的 `daily_reset_at` **对齐取较晚者**；触发会话迁移（04 §3.2）；UI 行标红「日额度耗尽 · 北京时间 00:00 重置」。

### A-07 IP 级限流全局生效 `[T-1-b/T-1-e]`
**Given** 3 个 AMD 账号同出口 IP。
**When** 上游对账号 2 返回 `ip_rate_limit_exceeded`（`Retry-After: 60`）。
**Then** 插件把**出口 IP 维度**置入冷却；3 个账号在 60s 内**均不再发请求**；60s 后恢复；UI 横幅出现「同出口 IP 已达上限」。

### A-08 三种错误壳解析 `[T-1-b]`
**Given** 分别为：① 顶层 `{"error":{...}}` ② `{"detail":{"error":{...}}}` ③ `{"type":"error","error":{"type":"rate_limit_error",...}}`；④ HTML 错误页；⑤ 空 body。
**Then** ①②③ 都能解出 message 与 code；④⑤ 不抛异常，归类 `unknown` 并按官方建议「以 status + Retry-After 为准」处理（04 §1）。

### A-09 模型目录字段落齐 `[T-1-c]`
**Given** 离线 fixture（照 02 §1.5 形状，含 DeepSeek-V4-Flash）。
**Then** `NormalizedModel` 含：`id`、`displayName`、`family`、`contextLength`、`pricing.prompt/completion/inputCacheRead`、`supportedParameters`、`capabilities.{reasoning,tools,vision,jsonMode,structuredOutputs}`、`stability`、`free`；价格字段**保持字符串**（`'0.00000014'` 不得被转成 `1.4e-7` 浮点）。

### A-10 `free` 语义防误用 `[T-1-c]`
**Given** fixture 中模型 A `free:true`、模型 B **无 `free` 字段**。
**Then** B 被标 `costGuard:true`（必然耗 pts）；单测断言「不得因为缺字段把 B 当免费」；UI 侧「今日 pts」在含 B 的会话上**不**显示「不消耗」。

### A-11 模型不支持的 400 `[T-1-c]`
**Given** 400 + `message:"Requested model Foo not supported"`（**不是 404**）。
**Then** 分类 `model_missing`；**不**冷却 Key；触发一次目录刷新（有频率上限）；把 400 **原样**回给 DSH（不转 429）。

### A-12 用量端点字段映射 `[T-1-d]`
**Given** fixture 照 02 §1.6（`rpm_limit:30`、`daily_cost_limit_usd:10`、`..._remaining_usd:8.1588`、`daily_reset_at:'2026-08-26T00:00:00+08:00'`、`today{...}`、`by_model[...]`、`recent[]`）。
**Then** `dailyLimitPts=10`、`dailyRemainingPts=8.1588`；**`rpm_limit` 不得**写成账号级 20（断言：账号 rpmAccount 仍来自文档 20 或用户配置）；单位文案为 `pts`，**不出现 `$` 与「美元」**。

### A-13 用量端点 502 ⇒ 未知 `[T-1-d]`
**Given** `/v1/usage` 返回 502。
**Then** 账号额度状态 `unknown`，UI 显示上一次值与 `fetchedAt` 角标；**严禁**显示 `0`；断言 `remaining !== 0`。

### A-14 用量轮询占用预算 `[T-1-d]`
**Given** 5 分钟巡检开启。
**When** 推进 10 分钟 + 提交 40 个对话请求。
**Then** Recorder 中巡检请求数 **≤ 2**；且巡检请求**被计入** RPM 窗口（断言：某分钟窗口内「对话 + 巡检」总数 = 窗口放行数，不出现超额）。

### A-15 共享窗口跨端点 `[T-1-e]`
**Given** 同一账号依次打 `/v1/chat/completions`、`/v1/audio/speech`、`/v1/systemone`。
**Then** 三者计入**同一** 60s 桶；某分钟合计到 20 后，第四类请求（任一端点）均被闸住；日额度三端合并计数。

### A-16 代理注入 Key `[T-1-g]`
**Given** 客户端带 `Authorization: Bearer 客户端自己的垃圾值`。
**Then** 上游实际收到的 `Authorization` 是**池内选中 Key**，且不含客户端值；录制断言「插件不转发客户端 Authorization」。

### A-17 饱和时返 503 不返 429 `[T-1-g]`
**Given** 所有账号冷却 > `maxWaitMs`。
**Then** 本地返回 **503** + `Retry-After` + `{"code":"dsh_multipool_saturated"}`；始终没有向上游发请求（Recorder 计数为 0）。

### A-18 429 不缩水 Retry-After `[T-1-b]`
**Given** 上游 429 + `Retry-After: 60`。
**Then** 插件不立即重试（0 秒内无第二个请求）；重试发生在 `≥60s` 且 `<60×1.15s` 附近的抖动窗内；且**全局预算保持**（不因 429 而擅自把 rpmAccount 改小）。

### A-19 冷却原因可辨 `[T-1-b/T-2-c]`
**Given** 分别触发 `rpm_key / rpm_ip / concurrency / daily_quota`。
**Then** 账号 `cooldownReason` 四者可区分；浮层显示具体原因与剩余秒数（05 §3.3）。

---

## N · SenseNova（不可归因的降速）

### N-01 Base 与三协议路径 `[T-4-a]`
**Then** 请求打到 `https://token.sensenova.cn/v1`；`/v1/chat/completions`、`/v1/messages`、`/v1/responses` 三条均可透传（02 §3.2）；鉴权 `Bearer sk-...`。

### N-02 无 `type` 字段的错误体 `[T-4-a]`
**Given** `{"error":{"code":16,"message":"Forbidden"}}`（**实测确实没有 `type`**）。
**Then** 不抛解析异常；归类 `auth`；Key 状态 `auth_failed`；**不启动重试循环**；UI 提示「Key 无权访问（code 16），请检查模型的 token-plan 权限」。

### N-03 429 归 `rate_opaque` 而非 `daily_quota` `[T-4-a]`
**Given** `429 {"error":{"type":...,"code":"quota_exceeded_error","message":"..."}}`。
**Then** 分类 `rate_opaque`；**不得**标账号 `quota_exhausted`；**不得**冷却到「5h 窗口边界」（D6 决策）；UI 同时显示两行「本次 429 可能是速率 也可能是额度」与「如需确认请到控制台页核对」。

### N-04 降速曲线 `[T-4-b]`
**Given** 起始 `admitRpm=3`。
**When** 连续 3 次 429（间隔 10s，中间各有 1 次成功）。
**Then** `admitRpm` 依次 3→1.5→1.0(=下限)→1.0；退避等待分别 ≈30s(±20%)→60s→120s 起算，不出现平行洪峰；第 3 次后触发**会话迁移**（04 §6 第 3 条）。

### N-05 升速上限 `[T-4-b]`
**Given** `admitRpm=1`，其后 30 分钟零 429 且请求 ≥10/10min。
**Then** 逐步 × 1.25 上调，**封顶 30**；单测断言从未越过 `HARD_CAP`。

### N-06 403 不降速 `[T-4-a]`
**Given** 403 `{code:16}`（Key 无权限）。
**Then** `admitRpm` 保持不变；Key 标 `auth_failed`；不发任何自动重试；其他 Key 不受影响。

### N-07 冷却期不升速 `[T-4-b]`
**Given** 刚触发一次 429（进入 5 分钟降速冷却期）。
**When** witness 一件成功。
**Then** 冷却期内 `admitRpm` **不上调**；冷却结束且满足成功条件才升。

### N-08 429 后同一请求不并行重试 `[T-4-b]`
**Given** 同一 requestId 429。
**Then** 插件内只有 1 个在途重试（断言上游收到同 requestId 的并发数 ≤1）。

### N-09 模型目录字段 `[T-4-c]`
**Given** fixture 照 02 §3.5（含 `context_length`、`max_output_length`、`pricing.input_cache_read`、`supported_features`）。
**Then** 字段落齐；`reasoningLevels` 取自**本地资料**（`source:'doc-local'`，ref 行号），**不是** API；「无 `pricing` 的模型」`pricing=null` 且 UI 显示 `—`。

### N-10 无用量端点 `[T-4-d]`
**Then** `fetchUsage()` 返回 `{available:false,reason:'no-endpoint'}`；浮层额度行 `—  仅账户页可见` + 外链；后台**不发起**任何额度查询请求（Recorder 断言 0 次）。
**And**（可选手填态）用户填「已用/上限」，UI 显示比例条，但该值**不参与准入硬闸**——断言：把手填值改成 0 或 999999 时，放行速率不变。

### N-11 6.8 上下文冲突保留 `[T-4-c]`
**Given** `/v1/models` 返回 `sensenova-6.8-flash.context_length=1048576`（若不是此值，用例自动转为断言「与 `resolvedConflicts` 的 262144 冲突时进 `conflicts`」）。
**Then** `conflicts[field='contextLength']` 存在且含两值；UI 并排显示 `262144 (user 裁定)` 与 API 值；派生逻辑用 **262144**。

---

## B · NVIDIA NIM

### B-01 40 RPM 标注来源 `[T-5-a]`
**Then** 设置页显示「RPM 上限 40 · 来源：用户确认（官方 API Reference 未逐字给出）」；断言 UI 字符串里同时出现 `用户确认` 与 `未逐字`。

### B-02 响应头存在则校准、缺失不报错 `[T-5-a]`
**Given** 响应带 `X-RateLimit-Limit: 40`、`Remaining: 7`、`Reset: 1730000123`。
**Then** 头被读取，`Reset` 归一化为时间差，后续预算以「剩余 7」为更小值。
**Given** 改写 fixture 去掉全部 `X-RateLimit-*`。
**Then** 照常工作，纯本地预算，无异常、无报错日志（`warn` 也不产生）。

### B-03 Reset 头 epoch 归一化 `[T-0-b]`
**Given** `Reset: '1730000123'`（秒）、`'1730000123000'`（毫秒）、`'12'`（相对秒）。
**Then** 三者分别推得「约 2024-10-27 的绝对时刻秒」「同一时刻毫秒」「12s 后」；**不得**把毫秒当秒算出「等 5 万年」。

### B-04 NIM 无用量端点 `[T-5-a]`
**Then** 额度行 `—  官方未提供用量接口`；断言后台无 `/usage` 之类的探测请求（Recorder 0 次）。

---

## G · Agnes

### G-01 402 与 429 分开 `[T-5-b]`
**Given** 402 `"The account balance or available quota is insufficient to complete the request."` → 分类 `plan_credit`；429 → 分类 `rpm_key`/`concurrency`。
**Then** 402 的冷却 ≈ 5h 窗口剩余；429 冷却 ≈ 60s×(1±15%)；**两者不共用**熔断窗、不共用 UI 计数（05 §3.2 第 3 行分两项）。

### G-02 403 模型级 `[T-5-b]`
**Given** 403（Key 对该模型无权限/区域受限）。
**Then** `(account, model)` 标不可用；**admitRpm 不变**；换另一模型可成功；UI 提示「该 Key 无权访问此模型」而非「限流」。

### G-03 免费档默认 RPM=20 `[T-5-b]`
**Given** 设置里 `planTier='free'`（用户默认）。
**Then** `rpmLimit=20`（source doc），`admitRpm=17`（doc×0.85, source assume）；UI 显示两个值+来源。

### G-04 5h/周请求数配额（用户填了才生效）`[T-5-b]`
**Given** 用户填 `planTier='free'` 且**未**填请求数配额。
**Then** UI 5h/周两行显示 `—  未配置`；**不**用付费档数字冒充。
**Given** 用户选了 Starter 并确认。
**Then** 5h=1500、周=15000 参与软提示（到 90% 变黄），但**不**本地硬拒。

### G-05 creditsPerUsd 假设可见 `[T-5-b]`
**Then** 任何 Credits↔USD 换算旁都有 `≈` 与「假设 6600 credits/$（待校准）」；断言 UI 不出现「$0.00 已用」这类把假设写成定论的文案。

### G-06 Agnes Key 前缀软提示 `[T-5-b]`
**Given** 用户粘贴 `sk-` 开头 Key 到 Agnes。
**Then** 仅提示「Agnes 常用 sk- 前缀，与文档一致」，**不**拦截。

---

## U · 通用（工具 / 环境 / 脱敏）

### U-01 `parseRetryAfter` `[T-0-b]`
`'60'` → 60s；`'Wed, 21 Oct 2026 07:28:00 GMT'` → 正确秒差；`'0'` → 0；`undefined` → null；`'60s'`/`'abc'` → null 且**不抛**。

### U-02 `parseTokenCount` `[T-0-b]`
`'1M'`→1048576? **错**：这里要**明确**：官方 `context_length` 是数值 `1048576`；`'1M'` 只出现在文档文字里，解析为 `1000000` 并 `ambiguous:true`，或直接不解析、要求数值。用例断言：**配置里只接受数值字段**；`'65.5K'` → `ambiguous:true`，`value:null`，`raw:'65.5K'`（禁止猜成 65500 或 67072）。

### U-03 精确计价 `[T-0-b]`
`estimateCost(1_000_000, '0.0000000028')` ⇒ `'0.0028'` 精确匹配（十进制字符串，无 `0.0028000000000000004` 类浮点尾）。

### U-04 脱敏日志 `[T-0-b]`
把含 `rc-`、`sk-`、`cpk-` 的 3 个假 Key 塞进日志字符串 → 输出只剩前缀与 `…`；断言原始完整串**不在**输出中。

### U-05 脱敏导出 `[T-2-a]`
看板导出 JSON（全时段全板块）→ 断言文件中**不含**完整 Key；`keyIdMasked` 末 4 位可见。

### U-06 未知不渲染 0 `[T-2-b]`
NIM / SenseNova 的额度字段为 `unknown` → HTML 文本断言出现 `—` 或 `未提供`，**不出现** `0%`、`0 pts`、`$0`。

### U-07 未知不可排序 `[T-3-b]`
表头点「剩余额度」排序：`unknown` 行**留在原位**（或落到底部并标注），不得按 0 排到最前（避免误判「快用完了」）。

### U-08 折线断裂 `[T-3-b]`
某分钟无 `promptTokens` → 该点不在系列里；`connectNulls=false`；断言图表 option 里该点 `value` 为 `null` 而非 `0`。

---

## C · 设置面板

### C-01 预算自检拦截 `[T-2-d]`
**Given** AMD 并发输入 `9`（> 官方 8）。
**Then** 保存被阻止，出现含出处（官方限流页 + 抓取日期）的错误文案。
**Given** 改为 `6` → 保存成功。

### C-02 rejected_key `[T-2-d]`
**Given** AMD 组粘贴 `sk-` 开头串；或粘贴 `https://jupyter.anruicloud.com/inference/xxx/v1`。
**Then** 红字：`这看起来不是 Token Factory 的 rc- Key（详见 02 §1.1）`；**不保存**。

### C-03 Base URL 只读 `[T-2-d]`
断言五家 Base URL 输入框 `disabled`，仅可复制；不存在「自定义 baseURL」保存路径（防错配到实例服务路径，02 §1.2）。

---

## D · 保留与存储

### D-01 30 天滚动清理 `[T-1-h]`
**Given** 造 31 天的事件（每天 10 条）。
**Then** 第 1 天的全清；第 2~31 天保留；`DailyRollup` **31 天全在**（长期）。

### D-02 存储不含正文 `[T-1-h]`
序列化 `MetricsEvent` → 断言无 `messages` 字段、无 prompt 文本、无 `Authorization` 值。

---

## S · 调度器语义矩阵（对应 04 §9，验证器名保持一致）

| ID | 断言落点 |
|---|---|
| S-01…S-20 | 与 `04-SCHEDULER.md §9` 表格逐行对应，实现时以该表为准逐条补 fixture |

---

## H · Google Gemini（第五家，默认关闭）

> 前置阅读：`02 §7`、`06 阶段 8`。Google 与另外四家的差异集中在三处：**限流按模型给**、
> **429 的语义要按 quotaId 分流**、**没有用量端点**。下面每条都要求断言"插件向上游发了什么"，
> 不是断言插件内部日志。

### H-01 速率类 429（RPM 超限）
**Given** FakeUpstream 对 `gemini-3.8-flash` 返回 429，body 为
`{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}`，
无 `RetryInfo`。
**Then** 分类为 `rpm_key`（不是 `daily_quota`）；冷却时长取官方退避（无 `Retry-After`、无 `RetryInfo` ⇒ 本地 2s 起指数退避，附抖动）；
**During** 冷却期 Recorder 内该模型的请求数为 0，但**其他模型**不受影响（按模型分桶的直接证据）。
**And** UI 记为「本地限流」，**不**降到「上游无额度」计数（05 §3.2 第 3 行、05 §6）。

### H-02 配额类 429（RPD 耗尽）
**Given** 同一个模型，429 body 的 `quotaId` 为 `GenerateRequestsPerDayPerProjectPerModel-FreeTier`。
**Then** 分类为 `daily_quota`；`coolUntil` 落在**太平洋时间次日零点**（`quotaTimezone: 'America/Los_Angeles'`），
而不是北京时间零点、也不是"现在 + 24h"。
**And** `admitRpm` **不**因此下调（降到 1 也没用，次日额度照样只有 20 次）。
**And** UI 的「上游无额度」计数 +1，与 H-01 的「本地限流」计数分开。

### H-03 无免费层模型的 429
**Given** 请求 `gemini-4-argon`（在 `02 §7.4` 的 `noFreeTier` 清单里），上游返回 429 `RESOURCE_EXHAUSTED`。
**Then** 第一次就判 `daily_quota`（不试 3 次、不判"未知"）；**And** 该模型在 UI 上显 `Free 档不可用` 灰标，
而不是"冷却中 12h"这类误导性倒计时。

---

### H-04 模型目录 62 条全部落地（含分页）
**Given** 离线 fixture：`/v1beta/models` 分两页返回（`nextPageToken` 有值），共 62 条。
**Then** `fetchModels` 后 `models.length === 62`；Recorder 里上游恰好收到 **2** 次目录请求（翻页了）；
**And** 断言里**不**出现 `pageToken=\u0027\u0027` 这类"空 token 也请求一次"的多余请求。

### H-05 `models/` 前缀归一化
**Given** 上游 `name` 为 `models/gemini-3.8-flash`。
**Then** `NormalizedModel.id === 'gemini-3.8-flash'`（无前缀）。
**And** 用该模型发一次对话时，发给上游的 `model` 字段**带**回 `models/` 前缀（原生端点）——
即"UI 不带、请求时补"的转换只发生在适配器内部（`03 §3.3`、`02 §7.6`）。

### H-06 缺字段不猜
**Given** 某条目**没有** `inputTokenLimit`，**没有** `outputTokenLimit`，也没有 `supportedGenerationMethods`。
**Then** `NormalizedModel.contextLength === null`、`maxOutput === null`、`capabilities` 全 `unknown`；
**And** UI 该行显 `—`，**不**显 `0`、**不**显任何推测值（铁律 5）。

---

### H-07 本地闸失效信号可观测
**Given** 本地预算 `admitRpm = 4`（Free 档 5 RPM × 0.85），但固化住 3 个 429 `rpm_key`。
**Then** 每个 `rpm_key` 事件带 `localGateFailed: true`；看板「本地闸失效」计数 +3；
**And** 下次预算重算时 `admitRpm` 下调（不是上调）——这是"学到的教训"，不是"恶意探测"。

### H-08 `RetryInfo.retryDelay` 优先于本地退避
**Given** 429 body 额外带
`{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"7s"}]}`。
**Then** 冷却时长取 `7s × (1 + 抖动)`（抖动仍为 ≥0、≤本项目的抖动上限），
**不**取本地 `2s` 起指数退避的首次值。
**And** 当 `retryDelay` 是超长值（如 `"3600s"`）时，**不**无条件照抄——超过
`maxCooldownMs`（默认 5 分钟，配置项）则 clamp 到 `maxCooldownMs` 并在 UI 标「上游要求冷却 3600s，已限幅」，
防止一个错误 body 把模型锁死一小时。

### H-09 404 与 400 不得混为一谈
**Given** 请求一个目录里没有的模型 ID。
**Then** 上游 404 `NOT_FOUND` ⇒ 分类 `model_missing`：**不重试**、**不冷 Key**、把 404 原样回给调用方（不转成 429/503）；
**Given** 同一次请求 `temperature` 传 `9`（超范围）⇒ 上游 400 `INVALID_ARGUMENT`。
**Then** 分类 `client_4xx`：**不重试**、**不冷 Key**、原样返回。
**And** 两档在事件里 `rateKind` 不同（H-09 断言里 `model_missing !== client_4xx`）。

---

### H-10 无用量端点：零额度请求 + 两张字样
**Given** Google 已配 1 Key，`FakeClock` 推进 10 分钟（期间不发任何模型请求）。
**Then** Recorder 内**额度类请求 0 次**——`/v1beta/models` 一次也**不**因为"想看额度"而被调；
确认插件没有把模型列表当余额探针（`02 §6` 非目标第 3 条）。
**And** 浮层 Google 卡片额度行同时含字样 `上游未提供用量接口` 与 `本地推算`；
**And** 渲染文本里**不含**任何形如 `0 pts` / `0 次` 的"额度为零"表述（可用 `U` 系列零值扫描器复用）。

---

### H-11 设置页第 5 组默认折叠
**Given** 首次打开设置页，Google 从未配置过。
**Then** 「Google Gemini」组**默认折叠**，标题右侧显 `未启用`；组内**不**出现「账号级 RPM」输入框
（因为 Google 无这一层：`02 §7.4`）；预算区只有「按模型」表，且表头有列说明「上限出自官方速率限制页（doc-local），
已用量为本地推算」。
**And** 其余四组（AMD / NIM / SenseNova / Agnes）的渲染不变（回归）。

### H-12 非 AIza 前缀软提示 `[T-8-e]`
**Given** 在 Google 组粘贴 `sk-` 或 `rc-` 开头的串。
**Then** 显黄字提示「这看起来不是 Google 的 Key（应以 `AIza` 开头）」；
**But** **不**拦截保存（与 `C-02` 区分：Google Key 前缀不是公开硬标准，不能因为提示错杀用户的合法 Key）。
**And** 若粘贴的是 `jupyter.anruicloud.com` 这类 AMD 实例域名，则与它家一样**硬拦截**
（那是 AMD 专属错误，不是"看起来不像"）。

---

### H-13 未知错误体不归错类 `[Z-07]`
**Given** 429 但 body 是 HTML 错误页、或 429 但 body 为空、或 429 但 `details` 结构无法解析。
**Then** 分类 `unknown`（**不是** `rpm_key`、**不是** `daily_quota`）；`raw` 字段保留 `status + body[:2KB]`；
**And** 冷却策略走「不冷 Key、换下一个候选重试一次」的保守分支（04 §5.1），
避免把一个非限流的 429 误判成"今日额度耗尽"而浪费其余四家的缓存。

---

## Z · 构建 / 类型 / 边界

### Z-01 全仓构建
`pnpm -r build` 通过；`pnpm -r typecheck` 0 error；**禁止** `as any`（ESLint 规则拦）。

### Z-02 单测覆盖闸门 `[T-7-a]`
`packages/core` 行 ≥85%、分支 ≥80%。

### Z-03 无裸时间源
`grep -rn "Date.now()\|new Date()\|setTimeout(\|setInterval(" packages/` 只允许出现在 `packages/core/src/clock.ts`（可注入时钟的实现文件）。

### Z-04 迁移不必要性统计 `[T-6-b]`
压测结束断言 `migrations_unnecessary === 0`（01 §7、§5）；该项写入测试报告缓存。

### Z-05 端口可配 `[T-1-g]`
默认 18888；改端口需重启（`applies:'restart'` 生效）；其余设置热生效——单测断言「改 rpmAccount 无需重启即改变放行数」。

### Z-06 卸载干净 `[T-2-b/T-3-e]`
禁用/卸载插件后：左栏图标消失、`main` panel 不再注册、`shell.overlay` 不残留、所有定时器（巡检/清理/learning tick）停止（用 `FakeClock` 推进 10 分钟后断言无新的上游请求、无新的写入）。

### Z-07 错误不吞 `[全部]`
每个适配器的分类函数有一条「未知错误体」用例：断言分类为 `unknown`、**保留原始 status + `<body[:2KB]` 原文**、且写入诊断环（可在 UI「诊断」里查看），不得静默变成 `ok`。

---

## 完成定义（DoD）总表

一个任务算「完成」需同时满足：

1. 对应夹具全绿，且夹具是**先写**（红）后实现（绿）。
2. `06-TASKS.md` 中该任务的勾选框打钩。
3. 没有引入新的 `Date.now()` 裸调用（Z-03 过）。
4. 若该任务改变了 UI 展示的**数值口径**（如把 `rpm_limit` 当账号级），必须在 `08-START-PROMPT.md` 的「已完成」区补充一行，并把 `05-UI.md` 对应表格改掉。
5. 若该任务新增了**未经官方文档确认**的数值，必须在 `catalog/limits.json` 标 `source:'assume'` 或在 `02-CONSTRAINTS.md` 的「未核实」区列出——**不得**直接插进代码注释当事实。
