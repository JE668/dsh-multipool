# 06 · TASKS（实现任务清单 · 分阶段 · 可勾选）

> 用法：在 DSH 创造模式里**逐任务**交给我做，不要一次给全部。每个任务都写了「完成定义（DoD）」和「验收用例（→ 07）」。
> 阶段原则：**先把 AMD 跑通到能看数字，再加第二个 Provider，最后才开跨 Provider 与沉浸看板。**
> 依赖顺序按 `dep:` 标注；没有 dep 的任务可并行。

---

## 阶段 0 · 仓库与骨架（半天）

### T-0-a 初始化仓库 `dep: 无`
- pnpm workspace；包目录：
  - `packages/core`（调度器、适配器接口、存储 —— **不依赖 DSH**，可纯 node 单测）
  - `packages/plugin-dsh`（Host 侧：cordis 插件、settings、代理 server）
  - `packages/client-ui`（浏览器半：左栏图标、浮层、看板、设置卡）
  - `docs/`（本目录 8 份文档）
- `package.json` 根脚本：`build` / `test` / `lint` / `typecheck`。
- **DoD**：`pnpm -r build` 全绿，空包能 tsc 过。
- **验收**：Z-01

### T-0-b 计费/日期工具 `dep: 无`
- `parseRetryAfter(v)`：支持秒数、HTTP date、`0`、缺失、脏值（`"60s"`）。
- `parseEpochish(n)`：NIM 的 reset 头归一化 —— `>1e12` 判毫秒，`>1e9` 判秒，否则相对秒（02 §2.2）。
- `parseTokenCount(str)`：`"1M"` `"512K"` `"65.5K"` `"1048576"` → `{value, raw, ambiguous}`（02 §5、03 §3.2）。
- `beijingDayKey(ts)`、`dailyResetAt(daily_reset_at | 默认 00:00+08:00)`。
- `estimateCost(tokens, pricingString)`：字符串小数用 **Decimal 类实现**（不用 float），返回字符串。
- `maskKey()` / `scrubSecrets(text)`。
- **DoD**：单测覆盖上表每一行 + 脏输入；`estimateCost(1e6, '0.0000000028')` 精确等于 `'0.0028'`。
- **验收**：U-01、U-02、U-03

---

## 阶段 1 · AMD 单 Provider 跑通（主机）

### T-1-a 适配器接口 + 注册表 `dep: T-0-b`
- `ProviderAdapter` 接口照 03 §5 实现；`adapters/amd.ts` 空实现先落地。
- **DoD**：`registry.resolve('amd')` 返回实例；未知 id 抛明确错误。

### T-1-b AMD 分类器 `dep: T-1-a`
- `classify()`：**只看 status + Retry-After**，code 仅归类（02 §1.4 警告）。
- 三种错误壳都要解：`error`、`detail.error`、`{type:'error',error:{...}}`。
- `daily_quota` 判据：网关层 429 **且** message 含 `Daily usage limit exceeded`。
- `readHeaders()`：解析 7 个 `X-RateLimit-*`；带 `-USD` 的标注「单位=pts，非美元」（02 §1.3）。
- **DoD**：单测 fixture 覆盖：平台 RPM、平台并发（5 种 code）、网关 RPM、网关日额度、Anthropic 壳、HTML body、空 body、502、503 `Model gateway is busy`。
- **验收**：A-01 ~ A-08

### T-1-c 模型目录（AMD）`dep: T-1-a`
- `fetchModels()`：GET `/v1/models`，**计入 RPM 但可绕并发**（02 §1.5）。
- 解析：`{data:[...]}` 无 `object`；`context_length` / `pricing`（字符串）/ `free` / `stability` / `supported_parameters` / `architecture` / `providers[]`。
- 严格处理 `free`：`free!==true` ⇒ **一定消耗 pts**，标 `costGuard: true`（这是 03 §3.3 的 `free` 语义）。
- `pricing` 里 `prompt` 既可能是 token 价也可能是字符价 → 有 `perCharPrompt` 时标 `pricingUnit:'chars'`。
- 目录刷新默认 10 分钟、失败保留旧值并标 `staleSince`；磁盘缓存 `catalog/amd.json`。
- 404 / `Requested model ... not supported`（**400 不是 404**）都要映射到 `model_missing`。
- **DoD**：真实 Key 下 `GET /v1/models` 能出 ≥1 个模型，字段按 02 §1.5 落齐；无 Key 时用离线 fixture 跑通。
- **验收**：A-09、A-10、A-11

### T-1-d AMD 用量轮询 `dep: T-1-c`
- `fetchUsage()`：GET `/v1/usage?include_recent=true`。
- 字段 `rpm_limit` **是 Key 级 30 不是账号级 20**（02 §1.6 明确写了）→ 写入 account 时**不得**用它当账号 RPM。
- `daily_cost_limit_usd` 等**名字带 usd 但单位是 pts**（02 §1.6 原文）→ 类型里叫 `dailyLimitPts`，UI 文案「pts」。
- **官方没有承诺这个端点不计 RPM**（02 §8 教训）→ 巡检间隔默认 **5 分钟**、最低 60s、与 Chat 共用预算计算。
- 502/超时 ⇒ `unknown`，保留上次值与 `fetchedAt`，**不得置 0**（02 §8 教训）。
- `daily_reset_at` 以东八区解析；`daily_reset_timezone` 非 `Asia/Shanghai` 时 UI Must 提示「以账号时区为准」。
- **DoD**：离线 fixture + 真实 Key 双跑；故意 502 时 UI 显示「未知（时间戳）」。
- **验收**：A-12、A-13、A-14

### T-1-e 共享窗口合并 `dep: T-1-b`
- 60s 窗口以 **account** 为键，**不是 endpoint**：`/v1/chat/completions`、`/v1/audio/speech`、`/v1/systemone` 记同一桶（02 §1.1 原文）。
- `dailyQuota` 也是这三条合并。
- **DoD**：单测里交替打 3 条端点，总计数不超过 20。
- **验收**：A-15

### T-1-f 主动闸 + 粘性路由 + 熔断 `dep: T-1-e`
- 照 04 §2/§3/§4 实现：滑动窗口预算、`stickyPick`、`leastLoad`、`shouldMigrate`（AMD `MIGRATION_BIAS=3.0`）、熔断。
- 预算 = `min(accountRpm20, keyRpm30) × 0.85 ÷ assumedExternalClients(1.5)`，且被 `X-RateLimit-Remaining-User-RPM` 校准取小（04 §2.2/§6.2）。
- **DoD**：04 §9 的 S-01 ~ S-08 全绿（假时钟注入，不打真网）。
- **验收**：S 系列

### T-1-g 本地代理 + DSH 接入 `dep: T-1-f`
- `127.0.0.1:<port>` 起一个 OpenAI 兼容代理；`GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/messages`（Anthropic 透传）、`POST /v1/messages/count_tokens` 转发到 AMD。
- 转发时**注入选中的 Key**，绝不把客户端自带的 `Authorization` 透传上去。
- 流式响应：首字节前完成准入与选 Key；响应头透传 `X-RateLimit-*`（重命名带前缀 `X-DSH-MP-*` 避免与上游混淆）。
- 本地 503（饱和）：`Retry-After` + `{code:'dsh_multipool_saturated'}`。
- 端口 `applies:'restart'`：端口默认 **18888**（避开常用 8080/3000），可改。
- **DoD**：把 DSH 的 `baseUrl` 指向代理、`apiKey` 随便填一个占位（代理忽略）后，DSH 里对话正常；拔掉 Key 时报本地 503 而不是上游 429。
- **验收**：A-16、A-17

### T-1-h 事件采集与 30 天保留 `dep: T-1-g`
- 按 03 §3.4 写入 `MetricsEvent`（**不含请求正文**）；日级 `DailyRollup` 长期。
- 每分钟滚动清理 `ts < now - 30d`。
- **DoD**：造 31 天假事件，清理后边界正确（第 30 天 23:59 仍在，第 31 天 00:00 没了）。
- **验收**：D-01

---

## 阶段 2 · AMD UI（左栏 + 浮层）

### T-2-a Host→Client 数据契约 `dep: T-1-h`
- 暴露只读查询：`getGlobalSummary()` / `getAccounts()` / `getSeries(q)`。
- 序列化时过 `scrubSecrets`；单测断言输出不含完整 Key。

### T-2-b 左栏图标 + 徽标 `dep: T-2-a`
- `ctx.slots.inject('sidebar.panellist', ...)`，包在 `ctx.effect()` 里，禁用即卸载。
- 徽标语义照 05 §2.2；灰态=未配置。
- **DoD**：开/关插件图标出现/消失，不留残影；窄栏折叠时 tooltip 三行信息完整。

### T-2-c 浮层 `dep: T-2-b`
- 四段结构照 05 §3；AMD 卡片三行按 05 §3.2。
- 不同步刷上游：浮层只读内存快照 + 60s 缓存值。
- **验收**：U-04 ~ U-07

### T-2-d 设置面板（AMD 组 + 全局组）`dep: T-2-c`
- Host：`settings.installSection('dsh-multipool', schema)`。
- Client：`settings.plugin.item` 卡片，key 一致。
- 保存前「预算自检」：并发 > 8 或 RPM > 20/30 ⇒ 阻止并给依据文案。
- `rejected_key`：填 sk- 或填实例域名 ⇒ 红字拒绝。
- **验收**：C-01 ~ C-03

---

## 阶段 3 · BI 看板（AMD 数据先打通）`dep: T-2-a`

### T-3-a 主面板注册 `main`
- `ctx.layout.registerPanel({id:'dsh-multipool-dashboard', title:'多 Provider 用量', render})`。
- 左栏图标点击 `selectPanel(id)`；看板内「返回会话」`selectPanel(null)`。
- 外层统一 `useEffect` cleanup。

### T-3-b KPI + ①请求/429 曲线 + ⑦明细表
- ECharts 按需引入；主题色从 CSS 变量读；亮暗切换订阅。
- 缺失字段 `connectNulls:false`；`—` 不可排序。

### T-3-c ②RPM ③并发 ④队列热力 ⑥学习画像
- ③ 并发由事件区间推；④ 热力 y 轴用对数桶（0-1s/1-5s/5-30s/30s+）避免长尾压扁。

### T-3-d ⑤ Provider×Model 桑基
- 只做流向，不做成本（ADR-8）。

### T-3-e 沉浸模式 `shell.overlay`
- 注册但**默认不挂载**；设置开关 `dashboardMode`。
- Esc 关闭；打开时不改变 DSH 其它状态；关闭后可回到原 panel。
- **验收**：U-08 ~ U-11

---

## 阶段 4 · 第二个 Provider（SenseNova，资料最全）

### T-4-a 适配器 + 错误码映射 `dep: T-1-b`
- Base `https://token.sensenova.cn/v1`；三条协议路径（chat / messages / responses）都要能透传（02 §3.2）。
- 错误体可能**没有 `type` 字段**（实测 `{"error":{"code":16,"message":"Forbidden"}}`）→ 用 `code`+`message` 归类；缺字段不得抛异常。
- `429 quota_exceeded_error` ⇒ `rate_opaque`（不可区分速率还是额度，02 §3.4）。
- `403 / code:16 Forbidden` ⇒ `auth`，人工恢复。
- **禁止**把 429 当 `daily_quota` 直接冷却到 5h 边界（D 决定：降速方案）。
- **DoD**：单测覆盖 code 16、429、429 带不足文案、400、500 全表。
- **验收**：N-01 ~ N-06

### T-4-b 降速退避曲线 `dep: T-4-a`
- 30s→60s→120s→240s→300s 封顶，±20% 抖动（04 §5.2）。
- 每 429 一次 `admitRpm ×= 0.5`（下限 1），冷却期内不升速；连续成功 ≥20 次且 10 分钟内 0 次 429 ⇒ `×1.25`（上限 30）。
- 连续第 3 次 429 ⇒ 触发本会话迁移（04 §6）。
- **DoD**：假时钟跑「429 连打 → 持续成功」两段，曲线符合预期且**不出现** 429 尖峰放大（比如降到 1 后卡死永不恢复）。
- **验收**：N-07、N-08

### T-4-c 模型目录（SenseNova）`dep: T-4-a`
- GET `/v1/models`；`data[]` 的 `id` / `context_length` / `max_output_length` / `pricing`（含 `input_cache_read`）/ `input_modalities` / `output_modalities` / `supported_sampling_parameters` / `supported_features`（`tools`/`json_mode`/`reasoning`）/ `description`。
- **显式** `reasoningLevels` 来自本地资料：`minimal/low/medium/high/xhigh/max`，`source:'doc-local'`，ref 行号。`/v1/models` 不带它，但这是已知事实，UI 可展示（标本地资料）。
- **冲突特例**：6.8 家族 `context_length` —— 用户裁定 262144（`resolvedConflicts`），API 若给别的值 ⇒ 进 `conflicts`，UI 并排显示，**不静默覆盖**。
- 图模型 `sensenova-u1.5-lite/fast` 与 LLM 分开，`role:'image'`，不进对话模型选择器。
- **验收**：N-09

### T-4-d SenseNova 无用量端点处理 `dep: T-4-a`
- `fetchUsage` 返回 `{available:false, reason:'no-endpoint', consoleUrl:'https://platform.sensenova.cn'}`。
- 额度卡显示「— 仅账户页可见 [打开控制台]」；**可选**手填「已用/上限」，现值只做展示与粗略提示，不做准入硬闸（避免用户填错导致全卡）。
- 积分消耗本地估算：需要各模型「积分/1K token」比率 —— **资料未给全**，缺失即 `unknown`，UI 展示 `—`。
- **验收**：N-10

---

## 阶段 5 · 另两个 Provider（NIM / Agnes）

### T-5-a NIM 适配器 `dep: T-4-a`
- Base `https://integrate.api.nvidia.com/v1`；`Authorization: Bearer`；模型 id 形如 `vendor/model`。
- RPM 以用户确认为准：40（`source:'user'`，UI 注释「官方 API Reference 未逐字给出」）。
- 读 `X-RateLimit-Limit/Remaining/Reset` 头（若存在）；reset 走 epoch 归一化；缺失不报错。
- 无用量端点 ⇒ `no-endpoint`。
- 429 无 `Retry-After` ⇒ 5s→10s→20s→40s→60s（04 §5.2）。
- **验收**：B-01 ~ B-04

### T-5-b Agnes 适配器 `dep: T-5-a`
- Base `https://apihub.agnes-ai.com/v1`；套餐档位必填（默认**免费**，按 D2：Key sk- 开头）。
- **402 `Payment Required` ⇒ `plan_credit`**（不是 429！），冷却到 5h 窗口边界，UI 单独计数并红标。
- **429 ⇒ RPM/并发**，冷却 60s±（04 §5.2）；`message` 只能辅助，不能据此判额度。
- **403 ⇒ 该 (account, model) 不可用**，不降 RPM、不冷 Key；全模型 403 才升 `auth`。
- 可选的 5h / 周请求数计数器（仅当设置里填了套餐配额）：对 Starter 1500/5h、15000/周；Pro 30000/5h、300000/周（02 §4.3）。
- **creditsPerUsd=6600** 作为**假设**（03 §6 / 02 §4.7），UI 上标「假设/待校准」，人民币计提 ÷6600；美元照标价。
- **验收**：G-01 ~ G-06

### T-5-c 四 Provider 统一配置页
- 设置面板每组统一字段布局（05 §5.1）。
- 「预算自检」覆盖四家各自的官方硬帽。

---

## 阶段 6 · 看板接入多 Provider + 跨 Provider 策略

### T-6-a 看板 Provider 筛选、卡线性色、空态
- 每家一组色（需过暗色对比度）；空态照 05 §6。

### T-6-b 跨 Provider 故障转移（默认关）
- 默认 `crossProviderFailover=false`；开启需二次确认。
- 开启后会话粘性键 `(sessionId, providerId, accountAlias)`；迁移优先同 Provider 内，**全部不可用**才跨 Provider。
- 任何跨 Provider 迁移写迁移事件（UI 可见）。

### T-6-c 会话内提示（D6）
- 额度耗尽 / 全冷却 / 本地 503 ⇒ 往当前会话插系统提示；同类 10 分钟内最多 1 条。

---

## 阶段 7 · 收尾

### T-7-a 单测覆盖率闸门
- `packages/core` 行覆盖 ≥ 85%，分支 ≥ 80%；解析器 fixture 全覆盖。

### T-7-b 真机联调脚本
- `scripts/smoke.ts`：四家各 1 Key，跑「拉模型 → 1 次对话 → 拉用量（有端点者）→ 打印结果摘要（脱敏）」。
- 无 Key 时打印 `skipped`，不失败。

### T-7-c README + 截图
- 安装、配置、已知限制（NIM 40 非官方、SenseNova 无用量 API、Agnes 无用量 API、creditsPerUsd 假设）、常见问题。

### T-7-d `gh` 推送
- `gh repo create dsh-multipool --private --source=. --push`（用户确认 private 还是 public）。

---

## 任务依赖速览

```
T-0-a ─┬────────────────────────────────────────────┐
T-0-b ─┼─ T-1-a ─ T-1-b ─┬─ T-1-c ─ T-1-d           │
       └─────────────────┼─ T-1-e ─┬─ T-1-f ─ T-1-g ─ T-1-h
                         (T-1-e 需 T-1-b)
T-1-h ─ T-2-a ─ T-2-b ─ T-2-c ─ T-2-d
T-2-a ─ T-3-a ─ T-3-b ─ T-3-c ─ T-3-d ─ T-3-e
T-1-b ─ T-4-a ─┬─ T-4-b
               ├─ T-4-c
               └─ T-4-d
T-4-a ─ T-5-a ─ T-5-b ─ T-5-c
T-2-a ─ T-6-a ; T-5-c 后 ─ T-6-b ; T-6-b 后 ─ T-6-c
T-6-* ─ T-7-*
```

---

## 一句话优先级

**T-0-b → T-1-b/c/e/f/g/h → T-2-b → T-3-a/b**：先到「AMD 单家、左栏图标能看到真实 rpm 与 pts、看板能出两条曲线」。其余都往后排。
