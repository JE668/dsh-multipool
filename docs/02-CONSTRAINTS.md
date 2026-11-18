# 02 · CONSTRAINTS（已核实的限制与错误语义）

> 本文件是**唯一的数值来源**。代码中不得内联硬编码这些数字，必须从 `catalog/limits.json` 读取；本文件与 `catalog/limits.json` 必须逐条一致。
> 每个数值后标注：`[doc]` 官方文档原文、`[doc-local]` 用户本地资料文件、`[probe]` 2026-11-17 实测探测、`[user]` 用户确认、`[assume]` 保守假设（不得当事实）。

---

## 1. AMD Radeon Cloud（Token Factory）

### 1.1 接入 `[doc]`

- Base URL：`https://developer.amd.com.cn/radeon/api/v1`（仅中国站）
- Key：`rc-` 开头；`Authorization: Bearer rc-...`
- 端点：`POST /v1/chat/completions`、`POST /v1/messages`（Anthropic 兼容）、`POST /v1/messages/count_tokens`、`GET /v1/models`、`GET /v1/models/utilization`、`GET /v1/usage`
- 所有路径加不加 `/api` 前缀等价（`/api/v1/models` === `/v1/models`）
- 网关只保留固定字段集，**不在其中的请求参数会被丢弃而不报错** → 不要用「发了参数没报错」推断「参数被支持」

### 1.2 限流：两层，独立生效，任一层可单独 429 `[doc]`

| 层 | 维度 | 数值 |
|---|---|---|
| 平台准入 | 每 API Key | **30 RPM** |
| 平台准入 | 每 API Key 并发 | **8** |
| 平台准入 | 每 IP | **120 RPM**，**仅在边缘节点能提供可信客户端地址时生效**（条件性，不得当作必然存在） |
| 平台准入 | 每模型并发 | 取决于该模型后端承受能力（未公开） |
| 平台准入 | 每服务进程 / 全平台 | 共享池（未公开） |
| 网关计量 | **每账号** | **20 RPM，60 秒滑动窗口** |
| 网关计量 | **每账号** | **每日用量上限（pts）**，按北京时间自然日累计，**00:00 UTC+8 重置** |

- 聊天、`/v1/audio/speech`、`/v1/systemone` **共用同一每分钟窗口与同一每日上限**。
- 原文引用：「每个请求要依次通过两层检查：平台先决定是否放行，网关再按账号计量。」

### 1.3 额度响应头 `[doc]`

官方原文：「每次成功调用都会在响应头里带上当前计数，一般不需要另外查询」。

| 头 | 含义 |
|---|---|
| `X-RateLimit-Limit-User-RPM` | 账号每分钟允许的请求数 |
| `X-RateLimit-Remaining-User-RPM` | 当前这一分钟还剩多少次 |
| `X-RateLimit-Reset` | 每分钟窗口重置的 Unix 时间 |
| `X-RateLimit-Limit-User-Daily-USD` | 当前周期的每日用量上限 |
| `X-RateLimit-Used-User-Daily-USD` | 本周期已经用掉的 |
| `X-RateLimit-Remaining-User-Daily-USD` | 请求被拒绝之前还剩多少 |
| `X-RateLimit-Reset-User-Daily-USD` | 周期重置的 Unix 时间 |

> `-USD` 里装的是 **pts**，不是美元，**不产生任何费用**。UI 不得加 `$`、不得叫「余额」。

### 1.4 429 语义 `[doc]`

**平台准入层**（每分钟类 → `Retry-After: 60`；并发类 → `Retry-After: 1`，当前请求结束即解除）：

```json
{"detail":{"error":{"message":"Model API rate limit exceeded; please retry later",
                    "type":"rate_limit_error","code":"<枚举>"}}}
```

code 枚举：`token_rate_limit_exceeded`、`ip_rate_limit_exceeded`、
`token_concurrency_rate_limit_exceeded`、`model_concurrency_rate_limit_exceeded`、
`process_concurrency_rate_limit_exceeded`、`global_concurrency_rate_limit_exceeded`

**网关计量层**（顶层 OpenAI 格式，code 统一 `rate_limit_exceeded`，`Retry-After` 按窗口算）：

- RPM：「Rate limit exceeded: maximum 20 requests per minute for this OneClick user. Please try again later.」
- 日上限：「Daily usage limit exceeded: maximum $N per period for this OneClick user.」→ `Retry-After` = 本周期剩余秒数

**`/v1/messages` 上网关用 Anthropic 格式**：`{"type":"error","error":{"type":"rate_limit_error","message":"..."}}`

**官方警告（必须照做）**：「不要只根据 code 判断。请根据 429 状态码处理，并遵守 Retry-After。两个独立的限流器都可能拒绝同一个请求，同一种情况下给出的 code 不同，而且平台的错误放在 detail 里。」

→ 解析器同时兼容 ①顶层 `error` ②`detail.error` 嵌套 ③Anthropic `error.rate_limit_error`；判定以 `status===429` + `Retry-After` 为准，code 只用于**归类展示**与**选退避曲线**。

### 1.5 官方退避建议 `[doc]`

- 按 `Retry-After` 等待，**「不要自己设定间隔」**，并叠加带随机抖动的指数退避；理由：大量客户端在 60 秒整点重试会再次撞出峰值。
- 并发：在客户端把并发控制在每 Key 配额以内；原文「用一个容量为 8 的信号量，比重试循环更简单，也更快」。
- 重试：「除了 429，不要重试其他 4xx 错误。400 或 401 重试多少次结果都一样。」
- 官方伪代码：`wait = float(r.headers.get("Retry-After", 60)); time.sleep(wait + random.uniform(0, 2) * (2 ** i))`

### 1.6 `/v1/usage` `[doc]`

`GET https://developer.amd.com.cn/radeon/api/v1/usage?include_recent=true`，`Authorization: Bearer <rc-key>`。

```json
{
  "rpm_limit": 30,
  "daily_cost_limit_usd": 10,
  "daily_cost_used_usd": 1.8412,
  "daily_cost_remaining_usd": 8.1588,
  "daily_reset_timezone": "Asia/Shanghai",
  "daily_reset_at": "2026-08-26T00:00:00+08:00",
  "today": {"requests":142,"errors":3,"total_tokens":88214,"prompt_tokens":31002,
            "completion_tokens":57212,"cost":1.8412,"last_request_at":"..."},
  "last_30_days": {"requests":2840,"total_tokens":1904221,"cost":39.77},
  "all_time": {"requests":9120,"total_tokens":6210443,"cost":128.44},
  "by_model": [{"model":"DeepSeek-V4-Flash","requests":120,"total_tokens":74001,"cost":1.55}],
  "recent": []
}
```

关键读法：

- **`rpm_limit` 是「每 API Key」30，不是账号 20。** 账号级 20 只能来自响应头 `X-RateLimit-Limit-User-RPM`。UI 必须分两行。
- `daily_cost_*` 单位是 **pts**（字段名带 `_usd` 却「不产生任何费用，也和你的积分无关」）。
- `recent` 仅 `include_recent=true` 时才有内容。
- **官方**未说明 `GET /v1/usage` 本身是否计入 RPM → 按「会计入」保守处理：默认 5 分钟刷新、用户可手动刷新、刷新间隔设下限 60 秒。~~不要 60 秒高频轮询~~（原方案 60 秒无出处，已废弃）。
- `/api/profile/model-usage`（控制台「积分与用量」页用的接口）走**浏览器会话**，不是 API Key，**插件不调用**。其 `status` 语义仅供参考：`ok` / `not_configured`（未配 Key）/ `not_available`（无数据）；**502 = 未知，不等于 0**。

### 1.7 模型列表 `[doc]`

`GET /v1/models`，外层**裸** `{"data":[...]}`，**无** `object`、**无** `owned_by`、**无** `created`。

字段：`id`、`name`、`description`、`family`、`aliases`、`architecture{input_modalities,output_modalities,tokenizer}`、`top_provider{is_moderated}`、`providers[]{providerId,externalId,pricing{prompt,completion,input_cache_read},streaming,vision,tools,reasoning,stability}`、顶层 `pricing`、`context_length`、`supported_parameters[]`、`json_output`、`structured_outputs`、`free`、`stability`。

- `pricing` 是**每 token 价格的字符串小数**（如 `"0.00000014"`），不是每百万 token 的 float。
- `free: true` 语义 = **「按零成本计入你的每日配额」**，**不是**「不占额度」。UI 禁止写「免费模型 / 不计额度」。
- `stability` 取值：`stable` / `beta` / `unstable` / `experimental`。
- 示例：`DeepSeek-V4-Flash` context_length `1048576`；prompt `0.00000014`、completion `0.00000028`、input_cache_read `0.0000000028`。

**官方原话：**

- 「列出模型不占用并发名额，但计入每分钟限制。」→ 拉目录**消耗 RPM**，必须串行、限频、缓存。
- 「模型目录是会变的……运行时去解析列表，别把名字写死，也要处理昨天还能用的模型今天没了的情况。」
- 「模型列表对所有 API Key 都一样，不按账号区分。」→ 同一 Provider 多 Key **共用一份目录**。

**模型名不在列表里** → 网关返回 **400**，message `Requested model <名称> not supported`（**不是 404**；请求不会到后端）。收到此 400 应视为「目录过期信号」，触发一次刷新而**不是**重试。

### 1.8 状态码 `[doc]`

| 码 | 含义 | 处理 |
|---|---|---|
| 400 | 参数无效 / 已有实例 / 积分不够 | 读 detail 修正，不重试 |
| 401 | 凭证缺失、格式错、无法识别 | 检查 `Authorization: Bearer rc-...`；Key 可能失效 |
| 403 | 已认证但无权限 | 不重试 |
| 404 | 模板/实例不存在，或该路径无模型提供 | 不重试 |
| 409 | 状态冲突 | 读 body code，稍后或修正 |
| 429 | 限流 | 按 `Retry-After` 退避 |
| 502 | 上游网关/后端不可达 | 通常暂时，退避重试 |
| 503 | 容量暂时不足 / 功能关闭 | 按 `Retry-After`（'Model gateway is busy' 默认 5s） |

平台错误**也**是 OpenAI 格式，但包在 `detail.error` 里。官方建议：「有 `body.error` 就读它；没有就读 `body.detail.error`；都没有时，把 `body.detail` 当作错误信息。HTTP 状态码和 Retry-After 在所有情况下都可靠。」

### 1.9 必须与 Token Factory 划清界限的路径 `[doc]`

实例上的模型服务（实例卡片里的 `sk-` Key + `https://jupyter.anruicloud.com/inference/<instance-id>/v1`）：

- 没有每分钟限制、没有并发配额、没有每日上限；超载时 **vLLM 排队而非 429**；
- 实例运行期间**无条件消耗积分**，与有没有请求无关；
- 代理返回 403 = Key 与实例不匹配 / 实例未提供模型；502 = vLLM 尚未接受连接。

→ 插件若检测到用户填入 `sk-` Key 或 `jupyter.anruicloud.com` 域名，**必须明确报错并拒绝启用该 Provider**，不得把 Token Factory 的限流逻辑套上去。

### 1.10 探测记录 `[probe]` 2026-11-17

- `GET https://developer.amd.com.cn/radeon/api/v1/models`（无 Key）→ **401**，body `{"detail":"Login required"}`，头含 `vary: Cookie, Accept-Encoding`、`server: nginx`、`x-request-id`。
  → 该端点需鉴权；可作「Key 是否有效」的轻量探针，但**每次计 1 RPM**，只在用户手动「校验」时触发，禁止定时探活。

---

## 2. NVIDIA NIM

### 2.1 接入 `[doc]`

- Base URL：`https://integrate.api.nvidia.com/v1`；`Authorization: Bearer $NVIDIA_API_KEY`（build.nvidia.com 获取）
- 模型 ID 形如 `namespace/model`，如 `deepseek-ai/deepseek-v4-flash`、`moonshotai/kimi-k3`、`z-ai/glm-5.3`
- 专用分类另有域名（`ai.api.nvidia.com/v1` 视觉/检索/安全、`health.api.nvidia.com/v1`、`optimize.api.nvidia.com/v1`、`climate.api.nvidia.com/v1`）；**本插件 v1 只接 `integrate`**
- Embedding/Rerank 走 `/embeddings`、`/reranking`，**不在本插件范围**

### 2.2 限流 `[user]`

- **40 RPM，用户确认「确定，大概率也是唯一限制」。**
- `rateLimitSource: 'user-asserted'`：UI 显示「用户设定 40 RPM」，**不得**写成「上游返回」或「官方文档」。
- 官方 API Reference 页未逐字给出该数字（2026-11-17 抓取 `docs.api.nvidia.com/nim/reference/models-1` 与 `/llm-apis` 只得导航、正文截断，无法引用原文）→ 每次代码/文档提及 40 都要带这一句注。
- **无 TPM、无余额端点、无配额窗口**（NIM 不暴露 credits / usage / rate-limit 查询端点）。

### 2.3 保守系数与本地准入 `[assume]`

- 本地准入默认 **34 = 40 × 0.85**，设置里可拉到 40（改为 1.0 系数）。
- UI 必须**同时**展示两行并分别标来源：
  - `上游限额 40 RPM — 来源：用户设定`
  - `本地准入 34 RPM — 来源：保守系数 0.85`
- 禁止合并成一个「40」显示。

### 2.4 429 处理 `[assume]`

官方文档未给出 429 结构 → 通用策略：有 `Retry-After` 就遵守；无则按本地预算退避（初值 1s，指数上限 60s，带抖动）。
NIM 是唯一**不因限流触发跨 Key 迁移**的 Provider（限额按 Key 线性叠加，迁移只会冷却缓存）。

### 2.5 模型列表 `[probe]` 2026-11-17

- `GET https://integrate.api.nvidia.com/v1/models` **无鉴权即 200**，`{"object":"list","data":[...]}`，本次 **32** 条。
- 每条仅 4 字段：`{id, object:"model", created, owned_by}`；`created` 全为占位值 `735790403`；`owned_by` 为 vendor 前缀（`nvidia`/`google`/`meta`/`mistralai`/`minimaxai`/`moonshotai`/`deepseek-ai`/`z-ai`/`bigcode`/`poolside`/`snowflake`/`openai`）。
- **该端点不是配额探针**：无鉴权也 200 → 不能判断 Key 有效、不能判断余额；**目录 ≠ 可调用**：列出不代表该账号有访问权（可调用性只能由实际调用的 401/404 判定）。
- **元数据只有 `id`**：无 `context_length`、无 `pricing`、无 `max_output`、无推理档位 → UI 一律 `(上游未提供)`。

---

## 3. SenseNova

> 来源：用户本机三份一手资料 `/Users/je/Downloads/AI provider and model/SenseNova AI API 文档.docx`（975,584 字节）、`SenseNova-API-文档整理.md`（147,927 字节 / 3,806 行）、`SenseNova-Provider-Model-配置速查.md`（10,008 字节 / 193 行）。docx 正文已导出为纯文本（4,098 行）并全文检索。

### 3.1 接入 `[doc-local]`

- Base URL：`https://token.sensenova.cn/v1`；`Authorization: Bearer $SENSENOVA_API_KEY`
- Key：`sk-` 开头；控制台（`platform.sensenova.cn`）`token-plan` / API Keys 处创建
- 三协议**共用同一域名与同一 Key**，仅路径不同：
  - `POST /v1/chat/completions`（OpenAI 兼容：文本 / 多模态 / 工具 / 流式）
  - `POST /v1/messages`（Anthropic 兼容；SDK 填 `https://token.sensenova.cn` 自动拼 `/v1/messages`）
  - `POST /v1/responses`（OpenAI Responses API；Codex 用，`wire_api='responses'` 且 `disable_response_storage=true`）
  - `POST /v1/images/generations`、`POST /v1/images/edits`（U1.5 系列）

### 3.2 限流数值：**不存在** `[doc-local]`（否定性结论，可引用）

对三份资料全文检索 `RPM` / `TPM` / `QPS` / `速率限制` / `限流` / `x-ratelimit` / `Retry-After` / `每分钟` → **0 命中**；`429` 仅出现于错误码表一行：

| `429` | `quota_exceeded_error` | 速率/额度溢出，建议指数退避后重试 |

推论（写进代码注释，不允许被后续实现「补全」）：

- SenseNova **把「速率超限」与「额度超限」合并成同一个 code、同一句 message** → 插件**无法**从响应区分二者。
- 该文档也**未记录任何限流响应头** → 不能假设 `X-RateLimit-*` 或 `Retry-After` 存在（可尝试读，读到算 bonus，读不到按预算退避）。
- **不得**引入「SenseNova 是 3 RPM」之类数字；任何初始准入值都必须标 `user` 或 `assume`。

### 3.3 积分体系 `[doc-local]`

凭 TokenPlan 账户。公测期两类池、两个时间窗（滚动 5 小时 + 滚动周）：

| 池 | 5 小时窗口上限 | 周窗口上限 | 备注 |
|---|---|---|---|
| 通用积分池 | **120,000** | **1,200,000** | 原文「由 60,000 提升至 120,000」「由 600,000 提升至 1,200,000」；生效时统一重置全员窗口额度 |
| Flash-Lite 专属积分池 | **60,000** | **600,000** | Flash-Lite 消费返赠活动已于 2026-10-27 下线 |

- 原文：「当前有滚动 5 小时和周两层周期限制，不同模型会根据实际用量扣除不同积分，具体余额、用量和扣减记录可以在**账户页面**查看。」
- Flash-Lite 专属池用完后，若账户仍有通用积分仍可使用 Flash-Lite，但**从通用池扣的部分不参与返赠**（原句见资料 :47 区段）。
- **没有**用量/余额查询 API → 插件只能本地估算（按模型积分扣除率 × 实际 usage token）+ 允许用户**手工录入**账户页真实值。

### 3.4 429 处理（采用 D6：降速，不整账户暂停）

- 收到 429 后：**降低该账户的准入速率**（乘性下调，如 ×0.5，下限可配），并按指数退避排队（初值 `30s` [assume]、上限 `300s` [assume]、带抖动）。
- **不**「整账户暂停到下一个 5 小时边界」；**不**「同类请求就地等 60 秒重试」。
- 速率恢复用 AIMD：冷却后每 N 次成功小幅回升（加法增），直到回到初始准入值或再次 429。
- 若同时满足「手工录入的账户页真实值显示通用池 5h 已用 ≥ 阈值（默认 90%）」→ 升级为**额度耗尽**处理：该账户整体暂停到下一 5h 窗口重算点。阈值判断**只允许用录入的真实值**触发，本地估算默认不触发（可配置开关 `pauseOnEstimate`，默认关）。
- UI 文案必须写清：「SenseNova 将速率与额度合并为同一个 429，插件按**降速**处理，无法归因」。禁止出现「RPM 已耗尽 / 额度已耗尽」的确定性归因。

### 3.5 模型 `[doc-local]`

| Model ID | 默认 max_tokens | 范围 | 默认 temp | 默认 top_p | 上下文 |
|---|---|---|---|---|---|
| `sensenova-6.8-flash` | 64K | [1, 128K] | 1 | 0.95 | **256K（262144）** `[user]` |
| `sensenova-6.8-flash-lite` | 64K | [1, 128K] | 1 | 0.95 | **256K（262144）** `[user]` |
| `deepseek-flash`（DeepSeek V4.1 Flash） | 65535 | [1, 65536] | 1 | — | 最高 1M |
| `glm-5.3` | 131072 | [1, 393216] | 1.0 | 0.95 | 最高 1M |
| `kimi-k3` | 128K（`max_completion_tokens`） | 最大 = 1024×1024 − prompt_tokens | 1 | — | 最高 1M |

> **上下文口径已定（D8）：`sensenova-6.8-flash` 与 `sensenova-6.8-flash-lite` 均为 256K = 262144 tokens，用户确认。** 依据：`SenseNova-API-文档整理.md:2422` 的 `/v1/models` 示例 `context_length: 262144`。资料中模型参数表写的「1M（1,048,576 tokens）」**判定为表格笔误**，不采用、不再作为冲突并排显示。
> **最大输出仍为 65536**（`SenseNova-API-文档整理.md:2423` 的 `max_output_length: 65536`），与上下文是两个字段；协议上限 128K 与端点默认值分开写。
> 解析器仍须保留通用冲突机制（任意字段 api 与 catalog 不一致时并排展示），只是本项已有人工裁定，裁定结果写入 `catalog/limits.json` 的 `resolvedConflicts`。

各模型差异 `[doc-local]`：

- 6.8 Flash / 6.8 Flash Lite：**思考模式默认开且不可关**；`reasoning_effort` 可选 `minimal|low|medium|high|xhigh|max`；思考内容与输出**共享** `max_tokens`；多轮无需回传 reasoning；**不支持同时开 thinking 与 JSON**。
- DeepSeek V4.1 Flash（`deepseek-flash`）：支持 thinking；携带 tools 时**必须回传全部历史轮次 `reasoning_content`**；视频输入**仅** Chat Completions 支持（Anthropic / Responses 不支持）。
- GLM-5.3（`glm-5.3`）：思考**始终开启不可关**（`thinking.type=disabled` 会失败）；**仅文本输入**；temp 上限 1.0；可 `do_sample=false`；与 `top_p` **只调一个**。
- Kimi K3（`kimi-k3`）：支持 thinking；不建议同时开 thinking 与 JSON；原生视觉；1M 上下文；输出用 `max_completion_tokens`。

通用参数 `[doc-local]`：`reasoning_effort` 默认 `high`；`temperature` [0,1]；`top_p` (0,1]；`n` [1,7]；`presence_penalty`/`frequency_penalty` [0,2]；`seed` [0,9999999)；`stream_options.include_usage` 默认 true。
思考类响应含 `reasoning`（Chat）与 `reasoning_content`；`usage.completion_tokens` **含**推理 token，明细在 `completion_tokens_details.reasoning_tokens`。

### 3.6 模型列表 `[doc-local]`（正式文档化，比 AMD 更全）

`GET https://token.sensenova.cn/v1/models`，Bearer 鉴权。原文：「列出当前可用的模型列表，返回每个模型的基本信息，包括能力、上下文长度、定价等。」

响应示例（`:2413-2438`）：`sensenova-6.8-flash-lite` → `created: 1777392000`、`input_modalities:["text","image"]`、`output_modalities:["text"]`、`quantization:"fp8"`、**`context_length: 262144`**、**`max_output_length: 65536`**、`pricing{prompt,completion,image,request,input_cache_read}`（示例均为字符串 `"0"`）、`supported_sampling_parameters:["temperature","stop"]`、`supported_features:["tools","json_mode","reasoning"]`、`description`、`openrouter{slug:"sensenova/sensenova-6.8-flash-lite"}`、`datacenters:[{country_code:"CN"}]`。

> 与 D8 一致：端点给的 262144 就是正确上下文，不是冲突。`pricing`全 `"0"` 是示例占位，**不得**据此显示「免费」；须以真实响应为准，缺失则 `unknown`。

### 3.7 错误结构 `[doc-local]` + `[probe]`

- 文档约定：`{"error": {"type": "...", "code": "...", "message": "..."}}`，状态码表：400 `invalid_request_error`、400 `failed_precondition_error`（前置条件不满足：编码失败/引擎不可用/安全检查未通过）、403 `permission_denied_error`（不支持当前语言）、404 `not_found_error`（模型 ID 不存在或已下线）、408 `canceled_error`（客户端取消）、429 `quota_exceeded_error`、500 `internal_server_error`。
- **实测不一致** `[probe]`：无效 Key 请求 `/v1/models` → **401**，body `{"error": {"code": 16,"message": "Forbidden"}}`，**无 `type` 字段**，`code` 是整数而文档示例是字符串。
  → 解析器对 SenseNova **必须容错**：`type` 可缺、`code` 判断用 `String(code)`；`401`/`403` 归 `auth`，不做限流冷却。
  → 文档状态码表**不含 401**，但实测存在；实现以实测为准并在 UI 注明。

---

## 4. Agnes-AI（国际站）

### 4.1 接入 `[doc]`

- Overview 原文：「OpenAI-compatible chat completions at `https://apihub.agnes-ai.com/v1/chat/completions`」；鉴权 `Authorization: Bearer YOUR_API_KEY`
- Quickstart：`export AGNES_API_KEY=sk-...`；示例 model `agnes-2.5-flash`
- Key 前缀：文档**未给出**。`[user]` 用户现用免费 Key 为 **`sk-` 开头**（此前社区插件文档的 `cpk-` 口径不适用）。→ 前缀检查**只允许**作为软提示，不得据此拒绝 Key。
- Dashboard 管 API keys 与 billing；订阅入口 `https://platform.agnes-ai.com/subscribe/subscription`

### 4.2 429 与 402 的语义分工 `[doc]`（五家中最清晰）

- **429 Too Many Requests**：「The request rate is too high and it exceeds the RPM limit of the current account.」常见原因：RPM 超限；**Free users are limited to RPM 20**；并发太多；短时间重复请求太多；自动重试频率太高。解决：等 1 分钟再试 / 降低频率 / 控制并发 / 合理重试 / 短时间避免重复请求 / 量大升级 Token Plan。
  → **429 只代表速率，与额度无关。**
- **402 Payment Required**：「The account balance or available quota is insufficient to complete the request.」原因：余额不足、Token Plan 配额不足、单次请求超出可用额度、订阅状态异常、充值/订阅未生效。解决：查余额、查 Token Plan 或订阅状态、充值或升级、**降低单次请求成本**（缩短上下文、降图像/视频规格）、充值生效后重试。
  → **402 才是「额度/积分耗尽」。**
- **403 Forbidden**：无权限访问该资源（Key 未开放该模型、企业认证/订阅/权限状态未生效、来源被安全规则拦截、IP/区域/网络受限）→ **不是限流**，不冷却 RPM。

其余 `[doc]`：400 参数非法（含上下文超长、第三方工具参数不兼容如 Codex、视频参数非法）；404 地址/路径/资源不存在（成因含「`/v1` 被第三方工具重复拼接」、base URL 配错、model 名错）；405 方法不支持；408 超时；409 冲突（重复提交、同一请求正在处理、资源状态不允许、第三方工具反复重发）；413 载荷过大；415 媒体类型不支持；422 实体不可处理（参数值不满足要求，含 seed/resolution/aspect ratio/FPS 越界、图生图 URL 不可访问、base64 非法）；431 Header 过大；499 客户端提前关闭；500/502/503/504/520/522/524（503 成因含「模型名错误、拉取模型列表失败、未选 fallback、未开 routing、工具把请求发到错误模型、服务暂时不可用」）。

**代码含义**：Agnes 适配器处理 402 → 标记「套餐配额/余额耗尽」并排队到 5h 边界，UI 提示「检查 Token Plan」；处理 403 → 标记「Key 无该模型权限/区域限制」，**换模型而非冷却 Key 的 RPM**；处理 503 → 先怀疑「模型名错/路由未开」，触发模型目录刷新，而不是盲目退避。

### 4.3 套餐与配额分档 `[doc]`

Agent Plan（文本 / 图片 / 视频共用一个额度池，可选 Credit 加购）：

| 档位 | 每 5 小时 Credits | 月 Credits | 文本 RPM | 图片 RPM（1K / 2K / 3K-4K） | 视频 RPM |
|---|---|---|---|---|---|
| Lite | 2,000 | 20,000 | **60** | 60 / 40 / 1 / 1 / 1 | 2 |
| Plus | 10,000 | 100,000 | **100** | 80 / 60 / 1 / 1 / 2 | 2 |
| Pro | 24,000 | 240,000 | **200** | 100 / 80 / 1 / 1 / 3 | 3 |
| Max | 60,000 | 600,000 | **500** | 150 / 100 / 2 / 2 / 5 | 5 |

- 扣款顺序：**先扣当前 5 小时窗口的套餐额度 → 不足则从加购积分包补足（不受窗口约束、永久有效）→ 仍不足等窗口重置**。
- 「Plan Credits outside the current window are not consumed」「RPM (requests per minute) limits apply independently」。
- 加购包：Mini 20,000/$2.99、Standard 100,000/$14.99、Premium 240,000/$34.99、Ultimate 600,000/$85.99；不过期、套餐到期仍保留、豁免 5 小时配额。
- **RPM 与 5h Credits 是两个独立约束，同时生效**（原文「Both Limits Apply」：Token Plan Pro 可能有 1000 RPM，但仍受 30,000 requests/5h 与 300,000/周 限制）→ 插件必须**同时**维护 RPM 窗口与 5h/周窗口两类计数器，任一满都排队。
- Credits 换算 `[doc-local]`：**6,600 Credits = 1 美元**，文本/图片/视频共用一池。
- Token Plan 的请求数配额（另一产品线，accordion 内）`[doc]`：Starter 1,500 req/5h 且 15,000/周；Plus 7,500/5h 且 75,000/周；Pro 30,000/5h 且 300,000/周；图片均 4,000 张/日；视频均 500 秒/日。文本按请求数计、图片按张数、视频按秒数。原文：「Existing RPM and subscription quotas apply together; adding Agent Plan does not replace your benefits.」

### 4.4 免费档（用户 D2 所在档位）

- 429 原因页明写 **「Free users are limited to RPM 20」**；但 tokenplan 页的 RPM 表里 **default / enterprise 档都写 `Dynamic`**，且说明「以 console 当前显示为准」。
  → 处理方式：`catalog/limits.json` 记 `agnes.free.textRpm = { value: 20, source: 'doc', note: 'Error-codes 页举例句；Token Plan 页另写 Dynamic，以 console 为准' }`；插件默认准入取 **20 × 0.85 ≈ 17** `[assume]`，并在设置面板提供「以 console 实际值为准」的输入框，用户填了就用 `user` 值覆盖。
- 免费档**没有** Agent Plan 的 5h Credits / 月 Credits 配额；「有额度」的判断只对 402 有意义（免费档也可能因余额/配额不足返回 402）。
- **不得**把 Agent Plan 的 60 RPM（Lite 档）当作免费档上限来用——那是订阅档位。

### 4.5 模型元数据：口径不统一，禁止猜 `[doc]`

per-model 页有「Limits and pricing」表，但**只有部分模型有**，且**单位写法三种**：

| Model ID | Context window | Max output | 来源 |
|---|---|---|---|
| `agnes-2.5-flash` | `512K` | `65.5K` | `/en/docs/agnes-25-flash.md` |
| `agnes-2.5-pro` | `1M` tokens | `65536` tokens | `/en/docs/agnes-25-pro.md` |
| `agnes-3.0-flash` | `512K` | `65,536` tokens | `/en/docs/agnes-30-flash.md` |
| `agnes-3.0-pro` | **Coming soon 占位** | 无 | `/en/docs/agnes-30-pro.md` |
| `agnes-2.5-pro-alpha`、`agnes-2.5-pro-beta`、`agnes-2.5-pro-theta` | **无独立规格**（wiki 无独立页 / 无 Limits 表） | **unknown** | llms.txt 索引缺失或页内无表 |

- **`65.5K` 的归一化规则（禁止猜）**：按 1024 进制是 **67072**，按 wiki 同族模型的 `65,536` 是 **65536**。两者都「说得通」，因此**不归一化整数**：保留原文串 `"65.5K"`，另存 `normalizedTokens: null`，置 `unitAmbiguous: true`，UI 原样显示并带 `?` 角标。
- `512K` / `1M` 同理存原文，`normalizedTokens` 仅在明确写成数字 token（如 `65536 tokens`）时填。

### 4.6 模型列表（实测 `[probe]`，非文档化）

`GET https://apihub.agnes-ai.com/v1/models`（Bearer）→ **200**，`{data:[{id,object,created,owned_by,supported_endpoint_types}]}`，本次 **10** 个：

```
agnes-2.5-flash, agnes-2.5-pro, agnes-2.5-pro-alpha, agnes-2.5-pro-beta,
agnes-3.0-flash, agnes-image-2.0-flash, agnes-image-2.1-flash, agnes-image-2.5-flash,
agnes-video-2.5, agnes-video-2.5-flash
```

- `created` 全为占位值 `1626777600`（2021-07-20）→ **无信息量，UI 不得展示为「上线时间」**。
- `owned_by` 全为 `"custom"` → **无信息量，UI 不得展示为「提供方」**。
- `supported_endpoint_types` 全为 `["openai"]`。
- **该端点不是鉴权/余额探针**：无效 Key 也返回 200（见 07 夹具 #6）；不能用来校验 Key 有效，也不能推断余额。
- **`agnes-2.5-pro-alpha` 在 API 目录里存在，但 wiki `llms.txt` 没有它的文档页** → 证明「从文档维护静态模型目录」必漏模型；**必须**以 API 动态结果为准，文档只做元数据补充。

---

## 5. 通用：什么算「已核实」

| 标签 | 含义 | 能否进 UI | 能否进默认值 |
|---|---|---|---|
| `[doc]` | 官方在线文档原文，已逐字核对 | ✅ 标「官方文档」 | ✅ |
| `[doc-local]` | 用户本机资料文件原文，已逐字核对 | ✅ 标「本地资料 + 文件名:行号」 | ✅ |
| `[probe]` | 2026-11-17 对 live 端点探测所得 | ✅ 标「实测 + 日期」 | ⚠️ 标 `learned`，可被后续观测覆盖 |
| `[user]` | 用户口头确认 | ✅ 标「用户设定」 | ✅ |
| `[assume]` | 无出处、本项目给出的保守值 | ✅ **必须**标「假设/待校准」 | ⚠️ 仅作初始，必须可配 |

任何数值**没有以上标签** → 禁止出现在代码、UI、文档中。

---

---

## 6. 非目标（与 01-PRD §5 对应，实现时直接引用这一节）

| 不做 | 原因 | 出处 |
|---|---|---|
| TPM 准入维度（不做底层 TPM 统计） | 四家官方文档都没有把 token 速率列为独立限流维度：AMD 只有 RPM / 并发 / 日 pts，NIM 只有 RPM，SenseNova 的 429 不可归因，Agnes 是 RPM 加 5h/周请求数。**Gemini 是例外**：官方速率限制页逐模型给出 TPM（且 Live 类模型只有 TPM），见 02 §7.4。但 TPM 仍**不**作为准入维度——插件不估 token 数，只把它当作「模型能吃多长」的展示信息，并用于避免发出必然 429 的超大请求。铁律 5 不变：不猜 token 数 | 01-PRD §5、02 §7.4 |
| 主动探针 | 假请求同样计入 RPM 与积分；最小请求通过只代表请求数桶恢复，不代表大请求可用 | 01-PRD §5 |
| 用模型列表当鉴权 / 余额检查 | NIM 无 Key 也 200，Agnes 无效 Key 也 200，AMD 计入 RPM，三条都测不出余额 | 01-PRD §5 |
| 跨 Provider 自动迁移 | 默认关闭，仅显式开启；供应商可能把同一请求在极短时间内出现在多个账户视为异常 | 04 §3.4 |

---

## 7. Google Gemini

> 来源：用户 `Google-Provider-Model-配置速查.md`（11048 B）+ `Google ai API 文档.docx`（2026-10-25 快照），2026-11-18 并入。价格与速率限制均 `[doc-local]`——这两份是用户从官方页面复制下来的快照，不是可复访的官方 URL。

### 7.1 接入 `[doc-local]`

- Base URL（标准 / REST）：`https://generativelanguage.googleapis.com/v1beta`。**pinned，不可改**：这个域名与 `v1beta` 路径同时出现在官方 SDK 默认值和文档示例里，用户改了就必然 404。`catalog/limits.json` 里 `baseUrlMutable: false`。
- Base URL（OpenAI 兼容）：`https://generativelanguage.googleapis.com/v1beta/openai`。路径结构与四家 OpenAI 兼容服务**完全相同**（`/chat/completions`、`/models`、`/embeddings`），所以不需要适配 OpenAI 的形状。
- Key：`AIza` 开头，后面跟 35 字符的 base64url 变体（字母数字 + `-` + `_`），总长约 39 字符。`aistudio.google.com` 的「Get API key」生成。**注意**：文档示例写作 `AIza-<GOOGLE_KEY>`，其中 `-` 是占位连接符，真实 Key **没有**这个横线——你之前说要按本地文件逐字核对这条，现在核完了：`AIza` 后面直接跟 body，无分隔符。前缀匹配用 `AIza`（不带横线），否则真实 Key 会被误判成非法。
- 鉴权两条路，按端点类型选：
  - REST / 原生 Gemini API：`x-goog-api-key: AIza...`（文档明确建议用头，不要用 `?key=` 查询串——查询串会被日志、代理、referer 一起带走，等于把 Key 打印到三处）
  - OpenAI 兼容端点：`Authorization: Bearer AIza...`
- SDK 名称与弃用情况：官方 SDK 叫 `google-genai`（PyPI）/ `@google/genai`（npm）。另外两个——`google-generativeai`（PyPI）/ `@google/generative-ai`（npm）——**已弃用**，官方明写了不要用。
- 这不影响插件（本插件直接发 HTTP 请求），但影响你在文档里引用官方示例的方式。

### 7.2 协议族与默认 API `[doc-local]`

**默认 API 是 Interactions API**：`POST /v1beta/interactions`（create / cancel / get / delete）。`generateContent` 是**遗留 API**，仍然支持，但不再接受新特性。

- 「默认」这个词是说官方文档首页和 SDK 默认都推 Interactions。插件不必跟随默认，因为这个 API 的请求/响应形状与 OpenAI 的 chat/completions 不同。本插件走 **OpenAI 兼容端点**（形状与另外四家相同），或原生 `generateContent` / `:streamGenerateContent`（需专门的解析器）。**不要**再选第三个形状——三种形状三种流式解析器，维护成本会压垮这个项目。
- 2026-05 官方对 Interactions 做了**破坏性变更**：`steps` schema 与响应格式变了。如果你选择走 Interactions，需锁定 `v1beta` 的某个时间快照；`v1` 稳定版没有这个变更。这条记在这里，是因为搜索资料看的是旧版，你复现不出来。
- `v1beta` 是当前默认，`v1` 是「稳定」档。**约定用 `v1beta`**：模型清单页给的所有端点上 `v1beta` 最全。`v1` 可能不覆盖新模型。这是取舍，不是官方结论。

### 7.3 OpenAI 兼容端点覆盖到什么程度 `[doc-local]`

OpenAI 兼容层覆盖的是**形状**（chat/completions 请求体、`choices[0].message` 响应体、流式 SSE 的 `delta` 语义），覆不上 Gemini 独有的**能力**：

- 连通调：`search_grounding`、`maps_grounding`、`code_execution`、`url_context`、`computer_use`、`file_search`，在 OpenAI 兼容端点上一般只能用「函数调用」模拟，或干脆不开放。
- Gemini 独有：`decision` 类模型（`gemini-decision-1`）、`antigravity` 系（Managed Agents，`antigravity-preview-*`）、`deep-research` 系（`deep-research-preview-*` / `deep-research-max-preview-*`）、Live API 系列（`gemini-*-live`），这些有自己的端点形状（`/v1beta/decisions`、`/v1beta/agents`、`/v1beta/interactions`、WebSocket `bidi-generate-music`），与 OpenAI 兼容端点不是一回事。
- 本插件 v1 **只接 OpenAI 兼容端点**（`/v1beta/openai`）。上面这些专用端点，插件只做「目录展示 + 计入配额统计是否会影响」，不做转发。这样实现量收敛在一个协议解析器里，与另外四家共用同一套重试/冷却/限流逻辑。
- 目录里必须给这些模型标 `route: 'dedicated'`（专用端点），且在 UI 上写明「本插件不代理此端点」。**不要**把它们塞进 chat/completions 的模型下拉——用户选了会得到 404，然后误以为是限流 bug。

### 7.4 限流：官方速率限制表（`[doc-local]`，照抄）`[doc-local]`

官方速率限制页按**层**给出 RPM / TPM / RPD。这两层指计费档位（Free / Paid），与 AMD 的「平台准入/网关计量」两层是不同概念——不要混用「层」这个词。

| 模型 | RPM | TPM | RPD |
|---|---|---|---|
| gemini-4-hydrogen | 5 | 250,000 | 20 |
| gemini-3.8-flash | 5 | 250,000 | 20 |
| gemini-3.6-flash | 5 | 250,000 | 20 |
| gemini-3-flash | 5 | 250,000 | 20 |
| gemini-2.5-flash | 5 | 250,000 | 20 |
| gemini-3.5-flash-lite | 15 | 250,000 | 500 |
| gemini-3.1-flash-lite | 15 | 250,000 | 500 |
| gemini-2.5-flash-lite | 10 | 250,000 | 20 |
| gemini-2.5-flash-tts | 3 | 10,000 | 10 |
| gemini-3.1-flash-tts | 3 | 10,000 | 10 |
| gemini-3.8-flash-tts | 3 | 10,000 | 10 |
| gemini-3.8-flash-lite-tts | 3 | 10,000 | 10 |
| antigravity-preview-09-2026 | 60 | 100,000 | 100 |
| gemini-decision-1 | 200 | 50,000 | 10,000 |
| gemini-embedding-001 | 100 | 30,000 | 1,000 |
| gemini-embedding-2 | 100 | 30,000 | 1,000 |
| gemma-4-26b | 30 | 16,000 | 14,400 |
| gemma-4-31b | 30 | 16,000 | 14,400 |
| gemini-robotics-er-2-preview | 5 | 250,000 | 20 |

- **无免费层**：`gemini-4-argon`、`gemini-4-carbon`、`gemini-3.1-pro`、`gemini-2.5-pro`、`gemini-2-flash` / `gemini-2-flash-lite`（即 2.0 系，已 Shut down，见 7.6）、图像 / 音乐 / 视频类（Nano Banana 系列、Lyria、Omni）、`deep-research` / `computer-use`。这些模型在 Free 档调直接 429 `RESOURCE_EXHAUSTED`，与本插件本地限流无关——UI 必须把「Free 档无此模型」和「本地预算用尽」两种 429 分开展示，否则用户会去调松预算。
- **Live 模型**（`gemini-2.5-flash-native-audio-dialog`、`gemini-3-flash-live`、`gemini-3.5-live-translate`、`gemini-3.5-transcribe-live`、`gemini-3.8-live` / `-extended-thinking`）：RPM 与 RPD 均「无限制」，只有 TPM 分别 1M / 65K / 20K / 20K / 65K 上限。这类模型的 429 只会由 TPM 触发，**只做请求数限流对它无效**——插件对 Live 模型的面板必须把 TPM 挂在前面，不能像其他模型那样 RPM 占首位。
- **工具计费**（与限流无关，但影响 pts 预算）：Search Grounding / Maps Grounding 免费额度：Gemini 2 与 2.5 系为 1,500/月，Gemini 3 及以后为 0（即不带免费额度），默认 1,500/月。付费层超出后 Search Grounding 为 $0.0125/次检索，上限 $10/1,000 次。
- **没有给出的数字不要推**：付费层（Paid）的 RPM / TPM / RPD **在用户提供的资料里没有逐模型数值**。catalog 里 `paid.*` 全部 `null` 且 `source: 'unknown'`。不要因为 Free 档数字有序（5 / 15 / 10）就假设 Paid 是 2 倍或 10 倍——Google 的 Paid 档是逐模型公布的，与 Free 「看起来像一条曲线」完全不是一回事。

### 7.5 429 语义：与 AMD 显著不同的一点 `[doc-local]`

- Google 的 429 是 gRPC 风格的 `RESOURCE_EXHAUSTED`，响应体：

  ```json
  {
    "error": {
      "code": 429,
      "message": "...",
      "status": "RESOURCE_EXHAUSTED",
      "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "37s"}]
    }
  }
```

- **`Retry-After` 头与 `retryDelay` 字段不是永远都在**：TPM 耗尽时通常带 `retryDelay`，RPM 超出时常常两者都没有。这直接与铁律 4 相撞——铁律 4 说「上游给的 Retry-After 优先」。**在 Google 上没有上游值可优先时，退回本地退避**（指数 + 抖动，起始 2 秒、上限 60 秒）。不要照抄 AMD 的 60 秒、更不要给它设到 24 小时。
- **配额归属（quota project / quota id）**：Google 的 429 有时带 `QuotaFailure` detail，指出被哪条配额限制（例如按 `GenerateContent` 请求数、或按 token 数）。插件 `classify()` **必须**读它，把 `rpm` / `tpm` / `rpd` 分出来，否则默认全部归 `rate_opaque`。tpm 类 429 不应该冷却整把 Key——降本次请求的 `max_tokens` 或换更小模型再试；rpd 类才冷却到次日 `Pacific Time` 零点。这两种 429 的处置完全相反，分错就是连锁失败。
- **`dailyQuota` 的重置时区是太平洋时间**（Google 每日配额），不是北京时间，也不是账号级 `/v1/usage` 返回的 `daily_reset_at`。`catalog/limits.json` 里 `quotaTimezone: "America/Los_Angeles"`。UI 的「重置剩余」文案必须按这个时区算，否则会早 8 或 16 小时显示「已重置」。
- **模型不存在/已关停**：返回 404 `NOT_FOUND`，message 含 `models/xxx is not found` 或 `is not supported`。与 AMD 的 400 不同，Google 用 404。插件对 404 不重试、不冷却 Key，触发一次目录刷新。

### 7.6 模型清单 `[doc-local]`

ID 一律带 `models/` 前缀（`models/gemini-4-hydrogen`）。**`generationConfig.model` 与 `GET /v1beta/models` 的 `name` 字段都要这个前缀；但 OpenAI 兼容端点的 `model` 字段不带前缀（`gemini-4-hydrogen`）。** 这是本 Provider 最容易踩的坑——两条路径前缀规则**相反**，且官方在 OpenAI 兼容文档里只用了一句「use the model name without the models/ prefix」带过。

插件在 `google` 适配器里需要一个显式函数 `stripModelsPrefix(id)` / `addModelsPrefix(id)`，调用点**只能**在 adapter 内部，禁止 UI 层自行拼接。`docs/05` 的模型选择器只展示 stripped 形态，`docs/03` 的 `NormalizedModel.id` 一律存 stripped 形态，`docs/07` 的 H-02 夹具专门验这个。

### 7.7 可玩性与排期 `[doc-local]`

- 用户在 Google 侧的档位是 **Free**（`planTier: free`）。Free 档的 20 RPD 非常小——RPD 20 意味着这个 Provider 只能做「偶尔切过去用一个非关键问题」的角色，**不能**承载长时间 agent 会话。05-UI 的 Provider 卡片必须在 Free 档显示「RPD 20：约够 20 次短对话」这句人话，而不是只显示 `20 RPD`。
- 免费层 TPM 250,000 = 单次 25 万 token 上限。长上下文模型（1M ctx）在免费层会**直接撞 TPM 而非 RPM**，这是第 2 个与四家都不同的点。`admitRpm` 的上调策略在 Gemini 上必须由 TPM 余量门控，不能只看 RPM。
- 结论：Google 适配器排在最后（06-TASKS 的阶段 8），是「第五家可选项」，不是主跑道。

### 7.8 变更记录 `[doc-local]`

- 清除（11-18 官方模型清单页标记 Shut down）：`gemini-2.0-flash`、`gemini-2.0-flash-lite`、`gemini-robotics-er-1.6-preview`、`gemini-2.5-computer-use-preview-10-2025`、`gemini-3.1-flash-lite-preview`、`gemini-3-pro-preview`、`imagen-4.0-generate`、`gemini-2.5-flash-image`（定价页写 2027-03-15 关停，迁移目标 `gemini-3.1-flash-lite-image`）。
- 清除（llms.txt 曾列、模型清单页端点表未确认，存在性无法核实）：`gemini-3.7-flash`、`gemini-3.5-flash`、`veo-3.1-generate-preview`、`veo-3.1-lite-generate-preview`、`veo-2.0-generate-001`、`gemini-robotics-er-1.5-preview`、`antigravity-preview-05-2026`、`deep-research-pro-preview-12-2025`、`gemini-embedding-2-preview`。这 9 项**不得注册**。
- 保留：`lyria-realtime-exp`（llms.txt 列、清单页复核确认存在）、`gemini-2.5-flash` / `gemini-2.5-flash-lite` 的定版 preview（有命名规范示例佐证）。
- ID 勘误 3 处：`antigravity-preview-09-2026`（非 05）、`deep-research-preview-04-2026`、`gemini-embedding-001`。
