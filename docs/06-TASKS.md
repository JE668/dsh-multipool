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

  A-07 已在 `04fd646` 收窄：不做出口 IP 维度，只给撞上的那一个账号标 `rpm_ip`。
  分类与映射（`packages/core/src/cooldown.ts`，`987666c`）已开一层；
  调度器接线在 `987666c` 时**仍未做**，归属 T-2-c（层里需要 verdict，而 `scheduler` 无此入参）。

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
- **官方没有承诺这个端点不计 RPM**（04 §8 教训）→ 巡检间隔默认 **5 分钟**、最低 60s、与 Chat 共用预算计算。
- 502/超时 ⇒ `unknown`，保留上次值与 `fetchedAt`，**不得置 0**（04 §8 教训）。
- `daily_reset_at` 以东八区解析；`daily_reset_timezone` 非 `Asia/Shanghai` 时 UI 必须提示「以账号时区为准」。
- **DoD**：离线 fixture + 真实 Key 双跑；故意 502 时 UI 显示「未知（时间戳）」。
- **验收**：A-12、A-13、A-14

### T-1-e 共享窗口合并 `dep: T-1-b`
- 60s 窗口以 **account** 为键，**不是 endpoint**：`/v1/chat/completions`、`/v1/audio/speech`、`/v1/systemone` 记同一桶（02 §1.1 原文）。
- `dailyQuota` 也是这三条合并。
- **DoD**：单测里交替打 3 条端点，总计数不超过 20。
- **验收**：A-15

### T-1-f 主动闸 + 粘性路由 + 熔断 `dep: T-1-e`
- 照 04 §2/§3/§4 实现：滑动窗口预算、`stickyPick`、`leastLoad`、`shouldMigrate`（AMD `MIGRATION_BIAS=3.0`）、熔断。
- 预算 = `min(accountRpm20, keyRpm30) × 0.85 ÷ assumedExternalClients(1.5)`，且被 `X-RateLimit-Remaining-User-RPM` 校准取小（04 §2.2/§6.4）。
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
- 徽标语义照 05 §2.2；灰态 = 未配置（`overall.configured === false`）。Host 未连上是另一回事：徽标写 `—/—`、不写 `0/0`，否则“没配”和“没人答”共用一个字形。
- **DoD**：开/关插件图标出现/消失，不留残影；窄栏折叠时 tooltip 三行信息完整。

### T-2-c 浮层 `dep: T-2-b`
- 四段结构照 05 §3；AMD 卡片三行按 05 §3.2。
- 不同步刷上游：浮层只读内存快照 + 60s 缓存值。
- **验收**：U-04 ~ U-07

### T-2-d 设置面板（AMD 组 + 全局组）`dep: T-2-c`
- Host：`ctx.inject(['settings'], child => child.effect(() => child.settings.configure({auto:false}, ctx.fiber)))` 注册命名空间 `dsh-multipool` 并关掉自动页。
- Client：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id:'dsh-multipool-amd', order:30, label:()=>t('nav'), locale:NS, inject:sectionInjected }, AmdSettingsSection))`，独立设置页（ADR-11）。
  - `settings.installSection` / `settings.plugin.item` 在 DSH 0.2.2-rc.3 **不存在**，不得再引用（见 05 §5「已知差异」、00 ADR-11）。
- 保存前「预算自检」：并发 > 8 或 RPM > 20/30 ⇒ 阻止并给依据文案。
- `rejected_key`：填 sk- 或填实例域名 ⇒ 红字拒绝。
- **验收**：C-01 ~ C-03

### T-2-e 账号存取层（Key 存哪，谁读它）`dep: T-2-d`
- Host：`ctx.credentials.set(ref, value)` 落盘、`ctx.credentials.resolve(ref)` 读回，`ref` 由本插件 Config 的 `refs: string[]` 指名；Config 里**只存引用名，不存 Key 本体**（03）。
- 不缓存：`resolve` 每次操作重新调一次，凭据层自己的文件锁 / 原子写 / 热发布负责一致性（b78）。
- 空串拒写走 `unset`，不写 `''`；Key 不出现在任何日志、错误串、快照线格式里（`scrubSecrets` 已兜住）。
- **验收**：U-04（日志无完整 Key）、C-02（`validateAmdKey` 在写盘前先拒）

  已落地（`de2d7f6`）。三处与最初设想不同，按实现记账：

  1. **跨进程那一跳不是 `ctx.credentials`**：浏览器半在另一个进程，`ctx.credentials.set` 它调不到。所以
     页面不走凭据 API，而走 channel 上的 `command({name, key})`；`apply` 收到后转调 Host 侧的
     `writeKeyStatus` / `clearKeyStatus`。凭据 API 只在 Host 这一侧被调用，与 03 的分工不矛盾。
  2. **`command` 是 channel 的成员，不是 window 上的第二个 key**：`client.js` 只读一个
     `CHANNEL_KEY`，第二个 key 等于给“两边必须同步”的约定再加一份。代价是页面必须先判断
     `typeof ch.command === 'function'`；这不是额外的负担，本来就该防旧 Host。
  3. **`KeyStatus` 不出界**：它的 `seam` 是四个方法的活动对象。`CommandOutcome.status` 改成扁平的
     `KeyReading { present, layer? }`，`outcomeOf` 里显式丢弃 seam。**没有任何可调用对象跨进程**。

### T-2-f 设置页 AMD 组（写入口）`dep: T-2-e`
- 独立设置页 `dsh-multipool-amd`（ADR-11），**不复用** `settings.plugin.item`（DSH 0.2.2-rc.3 没有）。
- 字段一个：AMD Token Factory 的 API Key。存：`channel.command({name:'save', key})`；清：`{name:'forget'}`。
- 保存前**只读**核对一次 `GET /v1/usage`：只读，不带 prompt，不消耗 pts，不是 02 §1 禁止的探针
  （`assume`，等用户确认后才落 02）。
- 红字拒绝（`validateAmdKey` 写盘前就拒，docs/02 §1.9）：`sk-开头的非 Token Factory 键`、Jupyter 实例域名。
- 并发 / RPM 文案必须带 §号引用 docs/02 §1.1、§1.4；本地估算带 `L` 徽标、不与上游上限相减（docs/04 §9.2）。
- `HostOptions.acceptsWrites` 默认 `true`（`f10d389` 起；传 `false` 可关）。
  - 这条原本写的是「默认 `false`，保存按钮落地时在同一提交里置 `true`」。
    设置页 `6f1c19c` 落地时漏了这一步，之后才发现：开关拨的不是一条旁路，
    而是 `writes` 的唯一来源——`openChannel` 的实参里没有 `writes`，
    `offer()` 全仓只有 `apply` 一处调用，`dispatch()` 读的就是它赋的那个变量。
  - 先把结论按证据深浅拆成三行，别把三行混成一句「设置页验过了」：
    | 断言 | 证据 | 状态 |
    |---|---|---|
    | 能读到 store 里的 AMD Key | 真机 `已存在本机（配置文件）` | 已验证 |
    | 能带这把 Key 向 AMD 发请求并读懂应答 | 真机 `已用 0.26 / 1 pts`，数字随上游变（0.65 → 0.26） | 已验证 |
    | 能写进（`save`）/ 删掉（`forget`）store 里的 Key | 无 | **未验证** |
  - 第三行为什么空着：`~/.dsh/.credentials.yaml` 的 mtime 停在 2026-11-16，
    早于本插件第一次安装（2026-11-28），说明那把 Key 是 DSH 自己写进去的，
    插件至今只读过它。验第三行就得真的覆盖或删除这把 Key，而覆盖是不可回滚的
    （原值只有用户手里有）。这不是「懒得验」，是「验的代价落在别人的凭据上」。
  - 所以第一次真机保存必须由用户自己按下去。在那之前，这一项按未验记录，
    不按通过记录——`f10d389` 让页面「应该能写」，不是「已经写过」。
- **验收**：C-01 ~ C-03、U-04

---

## 阶段 3 · BI 看板（AMD 数据先打通）`dep: T-2-a`

### T-3-a 主面板注册 `main`
- `ctx.layout.registerPanel({id:'dsh-multipool-dashboard', title:'多 Provider 用量', render})`。
- 左栏图标点击 `selectPanel(id)`；看板内「返回会话」`selectPanel(null)`。
- 外层统一 `useEffect` cleanup。

### T-3-b KPI + ①请求/429 曲线 + ⑦明细表
- 曲线用自绘 SVG polyline（DSH 浏览器侧无 echarts，无新增依赖），空分钟断开不连线，y 轴为 429 占比（0~100）。
- 表格九列：时钟、模型、状态、限流、耗时 ms、输入 token、输出 token、第几次、排队 ms；`null` 列印 `—`，不当 0 排序。
- `rowsOf` 只持有本进程启动以后的事件，更早的不在表里，表上标注「本次启动以后；更早的不在这里。」
- 曲线与表同一来自 `ENDPOINT_DASHBOARD` 一次应答，同一时刻，不拆两端点（07 U-08）。
- **DoD**：面板打开后三行 KPI 与左栏一致；无数据时曲线印「还没有记录到请求」而非平线；表无数据时印「还没有任何记录到请求。」
- **验收**：U-07、U-08、Z-06

### T-3-c ②RPM ③并发 ④队列热力 ⑥学习画像
- ②RPM 由 `ENDPOINT_DASHBOARD` 的 `trend` 折线承担（与 ①同一端点，同一小时窗口）。
- ③ 并发由事件区间推；④ 热力 y 轴用对数桶（0-1s/1-5s/5-30s/30s+）避免长尾压扁。
- ⑥ 学习画像：`reject-on-budget-exhausted` 开关在设置节，默认关。关时闸只记录与观察，不拒绝、不延迟；开时预算耗尽直接返回 429-like，不转发 AMD 上游。开关改动写入 `SourceFacts`，拦截层每次请求前动态读取，无需重装。
- **验收**：A-19（拦截与拒绝）、Z-05（开关持久化）

### T-3-d ⑤ Provider×Model 桑基
- 只做流向，不做成本（ADR-8）。

### T-3-e 沉浸模式 `shell.overlay`
- 注册但**默认不挂载**；设置开关 `dashboardMode`。
- Esc 关闭；打开时不改变 DSH 其它状态；关闭后可回到原 panel。
- **验收**：Z-06（卸载干净）、U-08（折线断裂不误解为 0）

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
- **creditsPerUsd=6600** 作为**假设**（03 §6 / 02 §4.6），UI 上标「假设/待校准」，人民币计提 ÷6600；美元照标价。
- **验收**：G-01 ~ G-06

### T-5-c 四 Provider 统一配置页
- 设置面板每组统一字段布局（05 §5.1）。
- 「预算自检」覆盖五家各自的官方硬帽。

---

## 阶段 6 · 看板接入多 Provider + 跨 Provider 策略

### T-6-a 看板 Provider 筛选、卡线性色、空态
- 每家一组色（需过暗色对比度）；空态照 05 §6。

### T-6-b 跨 Provider 故障转移（默认关）
- 默认 `crossProviderFailover=false`；开启需二次确认。
- 开启后会话粘性键 `(sessionId, providerId, accountAlias)`；迁移优先同 Provider 内，**全部不可用**才跨 Provider。
- 任何跨 Provider 迁移写迁移事件（UI 可见）。
- **DoD**：Z-04 的压测脚本在这一阶段真正落地——跑完输出 `migrations_total` 与 `migrations_unnecessary`，后者必须为 0（每次迁移都能在事件流里追到唯一原因：账号 429 `daily_quota`、日额度耗尽、或全 Provider 不可用）；`crossProviderFailover=false` 时 `migrations_cross` 必须为 0。
- **验收**：Z-04

### T-6-c 会话内提示（D6）
- 额度耗尽 / 全冷却 / 本地 503 ⇒ 往当前会话插系统提示；同类 10 分钟内最多 1 条。

---

## 阶段 7 · 收尾

### T-7-a 单测覆盖率闸门
- `packages/core` 行覆盖 ≥ 85%，分支 ≥ 80%；解析器 fixture 全覆盖。

### T-7-b 真机联调脚本
- `scripts/smoke.ts`：五家各 1 Key，跑「拉模型 → 1 次对话 → 拉用量（有端点者）→ 打印结果摘要（脱敏）」。
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
T-1-h ─ T-2-a ─ T-2-b ─ T-2-c ─ T-2-d ─ T-2-e ─ T-2-f
T-2-a ─ T-3-a ─ T-3-b ─ T-3-c ─ T-3-d ─ T-3-e
T-1-b ─ T-4-a ─┬─ T-4-b
               ├─ T-4-c
               └─ T-4-d
T-4-a ─ T-5-a ─ T-5-b ─ T-5-c
T-2-a ─ T-6-a ; T-5-c 后 ─ T-6-b ; T-6-b 后 ─ T-6-c
T-6-* ─ T-7-*
T-7-* ─ T-8-a ─┼─ T-8-b
             └─ T-8-c ─ T-8-d ─ T-8-e
```

---

## 一句话优先级

**T-0-b → T-1-b/c/e/f/g/h → T-2-b → T-3-a/b**：先到「AMD 单家、左栏图标能看到真实 rpm 与 pts、看板能出两条曲线」。其余都往后排。

---

### T-1-i 账号汇总诊断（只读，不参与调度）

- **背景**：04 §2.4 的结论是「一个 AMD 账号下挂 N 把 Key，账号级 20 RPM 仍然是 20 RPM，不会变成 N 乘以 20」。设置页因此要让用户能自己核对：当前假设的总容量与上游实际口径是否一致。
- **做法**：设置页 AMD 组提供「账号汇总诊断」按钮（只读），不做任何限流决策。点一次只发 1 个最小请求（`max_tokens: 1`），读响应头 `X-RateLimit-Limit-User-RPM` 与 `X-RateLimit-Remaining-User-RPM`（02 §1.5）。
- **展示**：上游 Limit 与本地假设（Key 数乘 30）并排；上游 Limit 明显小于本地假设时提示「疑似同一账号多把 Key，建议把 20 RPM 在账号间均分」，并给出手动改 `accountRpm` 的入口。诊断请求计入 RPM 预算、不豁免；60 秒内最多点 1 次；结果 UI 标 `[probe]` 与时间戳。
- **DoD**：不改 Key 状态、不改任何预算字段；无响应头时提示「上游未返回该头」而不是报错；诊断结果只进 UI 与事件流，不参与准入。


## 阶段 8 · Google Gemini 适配器（第五家，可选开启）

> 定位：**默认关闭**。Google 与另外四家有两个结构性差异，必须在实现前记住：
>
> 1. **限流是按模型给的**（`02 §7.4`），没有账号级 RPM。所以 Google 的 `Account.limits.rpmAccount` 恒为
>    `null`，闸 1（Provider 预算闸）在 Google 上按 `(providerId, modelId)` 组桶，不按账号。
> 2. **免费层 RPD 很小**（多数文本模型 20 次/天）。所以 Google 更多是「补充短问」而不是「主力长跑」，
>    这一点要写进设置页说明，避免用户配了 Key 却发现半小时就用完。

### T-8-a Google 适配器 + 错误映射 `dep: T-1-b`  `验收: H-01 ~ H-03`

- Base：REST `https://generativelanguage.googleapis.com/v1beta`，OpenAI 兼容 `.../v1beta/openai`（02 §7.1）。
- 鉴权：REST 走 **`x-goog-api-key` 头**，兼容端点走 `Authorization: Bearer`。
  **禁止** `?key=` 查询串（02 §7.1，会进日志/代理/referer）。
- 只接 **OpenAI 兼容端点**（02 §7.3）；`generateContent` / `:streamGenerateContent` / `interactions`
  只做目录展示，**不转发**。
- `classify()` 映射：
  - `429` + body 含 `RESOURCE_EXHAUSTED` ⇒ `rpm_key` 或 `daily_quota`（按 `QuotaFailure` 的 `quotaId` 区分，
    见 T-8-c）；
  - `429` 但 quotaId 是**模型级免费层额度**（`generate_content_free_tier_requests_per_day`）⇒
    `daily_quota`，冷却到**太平洋时间零点**（`quotaTimezone: 'America/Los_Angeles'`，02 §7.4），
    **不要**照抄 AMD 的 `Asia/Shanghai`；
  - `404 NOT_FOUND` ⇒ `model_missing`（Google 用 404 表示模型不存在，而 AMD 用 400——**这是两家最容易复制错的点**）；
  - `400 INVALID_ARGUMENT` ⇒ `client_4xx`，不重试；
  - `403 PERMISSION_DENIED` / API 未启用 ⇒ `auth`，人工恢复，不自动重试；
  - `429` 但无 `RetryInfo` ⇒ 退回本地指数退避（2s 起，60s 帽，抖动 ±20%）。
- **DoD**：单测覆盖上表每一种；`classify` 遇到未知 body 归 `unknown` 且保留 `status + body[:2KB]`（Z-07）。
- **验收**：H-01、H-02、H-03

### T-8-b 模型目录（Google，结构与其他四家完全不同）`dep: T-8-a`  
`验收: H-04 ~ H-06`

- `GET /v1beta/models`（`x-goog-api-key` 头）。
- 响应形状 `{ models: [{ name, displayName, version, description, inputTokenLimit, outputTokenLimit,
  supportedGenerationMethods, supportedActions, ... }], nextPageToken }`——**注意**：
  - 字段名是 `inputTokenLimit` / `outputTokenLimit`，**不是** `context_length` / `max_output_tokens`；
  - `name` 形如 `models/gemini-3.8-flash`，**归一化时必须 strip `models/`**；
    `NormalizedModel.id` 存**不带前缀**的裸 ID（与另外四家一致，UI 与调度器不能出现两种写法）；
  - 分页走 `nextPageToken`，**必须翻完**（默认 50 条一页，62 个模型会漏）；
- 映射：
  - `id` ⇐ `name` strip `models/`
  - `displayName` ⇐ `displayName`
  - `contextLength` ⇐ `inputTokenLimit`（**注意**：这是输入上限，不是总上下文；opendoc 里没有「总上下文」字段，
    所以 `NormalizedModel.contextLength` 用输入上限并在 `note` 里写清口径）
  - `maxOutput` ⇐ `outputTokenLimit`
  - `capabilities.tools/vision/reasoning` ⇐ 由 `supportedGenerationMethods` 与模型名后缀推导，推导不出来的
    一律 `unknown`（**不许猜**）——02 §7.6 与 03 §3.2 的铁律
  - `pricing` ⇐ **Google 的 `/v1beta/models` 不返回价格**，所以 `pricing` 一律 `null`
    （UI 显示 `—`），不要拿 `02 §7` 的价目表去填 API 字段（那是 `doc-local`，不是 `api`）
- **DoD**：喂一份 62 条的离线 fixture（含分页），断言 62 条全部落地、`models/` 前缀全被 strip、
  `pricing` 全 `null`、`contextLength` 来自 `inputTokenLimit`；再喂一份缺 `inputTokenLimit` 的条目，
  断言该模型 `contextLength` 为 `null` 而不是猜。
- **验收**：H-04、H-05、H-06

### T-8-c 429 的 quotaId 解析与「本地限流 vs 上游无额度」分开 `dep: T-8-a`  
`验收: H-07 ~ H-09`

Google 的 429 与 AMD 的**语义完全不同**，这是本项目最容易照搬错的地方：

- AMD 的 `rate_limit_exceeded` 是**网关/平台在拦你**，我们在本地主动闸就是为了不撞它。
- Google 的 `429 RESOURCE_EXHAUSTED` 有**两种**：
  1. **速率类**（RPM/TPM 超了）——`QuotaFailure.violations[].quotaId` 里带
     `generate_requests_per_minute` / `generate_content_per_minute` 之类 → 短冷却，且**是插件本地闸没拦住才发生**
     的信号，应该记「本地闸失效」，用来回调 §4 的保守系数；
  2. **配额类**（RPD 用完，或用户根本不在 Free 档里能用的模型）——`quotaId` 带 `per_day`；
     或者 **模型本身无免费层**（`02 §7.rb` 的 `noFreeTier` 清单，如 `gemini-4-argon`、`gemini-3.1-pro`）
     → 冷却到**太平洋时间次日零点**，UI 标「今日额度已尽」，并且**不要**降 `admitRpm`——
     降了也没用，第二天额度照样只有 20。
- `RetryInfo.retryDelay` 不一定存在（02 §7.5）：有就用它，没有就按上面两类各自的本地退避。
- **DoD**：
  - 两条假 429（一条带 `per_minute` quotaId、一条带 `per_day`）分类到不同 `RateKind`；
  - `noFreeTier` 清单里的模型即使从没成功过，第一次 429 也直接判 `daily_quota`（因为它的额度必然为 0），
    而不是判「未知，重试 3 次」；
  - UI 两条 429 计数分开（`05 §3.2` 第 3 行、`05 § Actual6` 的 Google 行）。
- **验收**：H-07、H-08、H-09

### T-8-d Google 无用量端点处理 `dep: T-8-c`  `验收: H-10`

- `fetchUsage()` 返回 `{ available: false, reason: 'no-endpoint' }`——Google **没有**「今天已用多少 RPM/TPM/RPD」
  的接口（与 NIM 同类）。**禁止**尝试用 `/v1beta/models` 或 quota 页猜测。
- 额度卡：上限来自 `02 §7.4` 表（`doc-local`），已用量来自本地计数（标 `本地推算`），
  两者之间**永不**相减出一个「余额」再当作事实展示（余额 = 本地推算，误差不可见，容易被当成权威数字）。
- **DoD**：`fetchUsage` 不被任何定时器调用（`FakeClock` 推进 10 分钟断言上游 0 次额度请求）；
  额度卡上有 `本地推算` 与 `上游未提供用量接口` 两个字样。
- **验收**：H-10

### T-8-e Google 设置组 + 跨时区重置显示 `dep: T-8-d`  `验收: H-11 ~ H-12`

- 设置页新增第 5 组「Google Gemini」，结构与其他四组一致（Key 列表、预算、目录刷新间隔、用量端点状态），
  但**预算区只有「按模型」的表**，没有「账号 RPM」输入框——因为 Google 没有这一层（`02 §7.4`）。
  这一点必须在 UI 上显式说明，否则用户会以为「输入框没显示 = 我没填对」。
- 默认关闭：首次进入时该组折叠并显示 `未启用`，展开后显示一段说明
  「Google 免费层按模型限速且 RPD 很小（多为 20 次/天），Google 的 Key 只做补充」。
- **时区**：重置时刻按 `quotaTimezone: 'America/Los_Angeles'` 渲染，并在本地时间旁**同时**显示太平洋时间
  （例如 `距重置 3h 12m（PT 00:00）`）。**禁止**套用 AMD 的「北京时间 00:00」文案——`05 §3.2` 只给 AMD 写死了
  「00:00 重置」，Google 行不能照抄。
- **DoD**：设置页第 5 组存在且默认折叠；GPU 实例服务域名（`jupyter.anruicloud.com`）式的鉴权防错**不适用**于 Google，
  但 `AIza` 之外的前缀（尤其 `sk-`、`rc-`）要提示「这看起来不是 Google 的 Key」——同 `C-02` 的做法，新增 `H-12`。
- **验收**：H-11、H-12

---

## 依赖图（本补丁追加）

```
T-1-b ─ T-8-a ─┬─ T-8-b
               └─ T-8-c ─ T-8-d ─ T-8-e
T-8-e 前置：T-5-c（统一配置页已有四组，第五组插在它后面）
T-7-a / T-7-b / T-7-c 在 T-8-e 完成后重跑一次
```

---

## 阶段 8 内部优先级

**T-8-c（429 的 quotaId 分流）> T-8-b（60 条目录 + 分页 + strip 前缀）> T-8-a > T-8-d > T-8-e**。

T-8-c 排第一，是因为「把 Google 的 429 当 AMD 的 429 处理」会让插件对一个**今天再也不会成功**的 Key 反复重试，
直接浪费掉其他 Provider 的会话缓存上下文。
