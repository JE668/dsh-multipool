# 08 · 启动 Prompt（粘贴进 DSH 创造模式）

> 用法：新建一个会话，切到 **创造模式**，把下面 **`---` 之间** 的全部内容贴进去，然后回车。
> 本机路径已按你的实际位置写好（`/Users/je/Documents/deepseek-harness/default-workspace/dsh-multipool`）。若换了机器，只改这一处路径。
> 贴完后我会**先读 `docs/00-README.md` 和 `docs/02-CONSTRAINTS.md`**，再按下面的「第一批只做这几件事」开工，不会一口气把 8 个阶段全写出来。

---

你正在为我构建一个 DeepSeek Harness 插件，项目名 `dsh-multipool`，代码放在 `/Users/je/Documents/deepseek-harness/default-workspace/dsh-multipool`。

## 先做什么（顺序不能乱）

1. **先读规格书，再写代码。** 依次读：
   - `docs/00-README.md`（铁律 + 已确认决策 D1–D7）
   - `docs/01-PRD.md`（目标、非目标、支持矩阵）
   - `docs/02-CONSTRAINTS.md`（四家 Provider 的**唯一数值来源**）
   - `docs/03-DATA-CONTRACT.md`（统一数据模型、`Sourced<T>`、`RateKind`）
   - `docs/04-SCHEDULER.md`（三道闸、粘性、退避、迁移代价）
   - `docs/05-UI.md`（左栏图标、浮层、看板、设置面板）
   - `docs/06-TASKS.md`（任务与依赖）
   - `docs/07-ACCEPTANCE.md`（夹具与 DoD）
   读完先**用 10 行以内**向我复述：插件要解决什么、三条铁律、当前阶段、第一批任务编号。复述不对就先别写代码。

2. **动手前用 `dsh-doc` 技能核对环境事实**（这些不能猜）：
   - 本机 DSH 版本与插件开发基线；
   - `sidebar.panellist`、`shell.overlay`、`ctx.layout.registerPanel` / `selectPanel`、`ctx.slots.inject`、`ctx.settings.installSection`、`settings.plugin.item` 的**当前真实签名**；
   - `package.json` 的 `dsh.bundle.patch` / `dsh.client` 声明格式；
   - `ctx.effect()` 的用法与卸载语义。
   若 `docs/05-UI.md` 里写的槽位名与当前版本不符：**以真实为准**，把差异记到 `docs/05-UI.md` 的「已知差异」小节，再继续。**不要**改掉 02 里的官方限流数值去迁就签名。

3. **仓库结构**（`docs/06-TASKS.md` T-0-a）：pnpm workspace，`packages/core`（纯 TS，不依赖 DSH，可 node 单测）、`packages/plugin-dsh`（Host 侧）、`packages/client-ui`（浏览器半）。

## 第一批只做这几件事（做完停下来给我看）

范围：**阶段 0 + 阶段 1 + T-2-b（AMD 左栏图标）**。不要碰看板、不要碰另外三家 Provider、不要碰跨 Provider 迁移。

1. `T-0-a` 仓库骨架 + `T-0-b` 工具（`parseRetryAfter` / `parseEpochish` / `parseTokenCount` / `beijingDayKey` / `estimateCost` **用十进制字符串实现、禁止 float** / `maskKey` / `scrubSecrets`），**先写单测再写实现**（U-01/U-02/U-03/U-04）。
2. `T-1-a` `ProviderAdapter` 接口 + 注册表（照 `03-DATA-CONTRACT.md §5` 原样）。
3. `T-1-b` **AMD 分类器**：只按 `status` + `Retry-After` 判定；`code` 仅用于归类与选退避曲线；兼容三种错误壳（顶层 `error` / `detail.error` / Anthropic `{type:'error',error:{...}}`）+ HTML body + 空 body。夹具 A-04 ~ A-08。
4. `T-1-c` **AMD 模型目录**：`GET /v1/models`，解析裸 `{data}`（无 `object`/`owned_by`/`created`）；价格一律**字符串**原样保存；`free` 语义照 02 §1.7（`free!==true` ⇒ `costGuard:true`）；400 `Requested model ... not supported` ⇒ `model_missing`（**不是 404、不冷却 Key**）；`GET /v1/models` **计入 RPM**（官方原话），拉目录要串行、限频、带缓存，默认 10 分钟。夹具 A-09/A-10/A-11。
5. `T-1-d` **AMD 用量轮询**：`GET /v1/usage?include_recent=true`；`rpm_limit`=30 是**Key 级**，**禁止**当账号级 20 用；`_usd` 字段单位是 **pts**，UI 文案不许出现 `$`；502/超时 ⇒ `unknown` 并保留上次值，**绝不置 0**；默认 5 分钟、下限 60 秒、巡检请求计入 RPM 预算。夹具 A-12/A-13/A-14。
6. `T-1-e` **共享窗口**：`/v1/chat/completions`、`/v1/audio/speech`、`/v1/systemone` 计同一 60s 桶与同一日上限。夹具 A-15。
7. `T-1-f` **主动闸 + 粘性 + 熔断**（照 `04-SCHEDULER.md`）；预算 = `min(20,30) × 0.85 ÷ assumedExternalClients(1.5)`，且被 `X-RateLimit-Remaining-User-RPM` 校准取小；`MIGRATION_BIAS=3.0`（依据：AMD `input_cache_read` 是 `prompt` 的 1/50）。夹具 A-01/A-02/A-03/A-18、S-01~S-20。
8. `T-1-g` **本地代理** `127.0.0.1:18888`（可配、`applies:'restart'`）：注入选中 Key，**绝不透传客户端 Authorization**；饱和返 **503** + `Retry-After` + `{code:'dsh_multipool_saturated'}`，**不伪造 429**。夹具 A-16/A-17。
9. `T-1-h` 事件采集（`MetricsEvent`，不含正文）+ 30 天滚动清理 + 日级 `DailyRollup` 长期。夹具 D-01/D-02。
10. `T-2-b` 左栏图标（`ctx.slots.inject('sidebar.panellist', ...)` 包在 `ctx.effect`），绿/黄/红/灰 + `available/total` 数字徽标 + 窄栏三行 tooltip（照 05 §2.3）。
11. `T-2-d` AMD 设置组 + 预算自检拦截（并发 >8 或 RPM >20/30 阻止保存并给官方出处）；拒绝 `sk-` 开头与 `jupyter.anruicloud.com` 域名（02 §1.9）。夹具 C-01/C-02/C-03。

**第一批的完成定义**：`pnpm -r build`、`pnpm -r typecheck`、`pnpm test` 全绿；A-01~A-18 / U-01~U-04 / D-01 / C-01~C-03 有对应测试；左栏图标能在本机 DSH 里显示绿/灰两态；不接真网的情况下用 `FakeUpstream` 跑通「30 个请求 → 20 个放行 → 无 429」。做完把**测试结果**和**改了哪些文件**贴给我，等我确认再进阶段 2。

## 硬约束（违反即返工）

- **不编造数值。** 限流/端点/错误码/响应头只能来自 `docs/02-CONSTRAINTS.md`；那里没的写 `unknown`，**不许**填「大概 40」「通常是 20」。尤其：NIM 的 40 必须标 `source:'user'` 并附「官方 Reference 未逐字给出」注；SenseNova **没有**任何 RPM/TPM 数值，不许引入。
- **来源随值走。** 每个进入准入判断或 UI 的数值都带 `source`（`api`/`doc`/`doc-local`/`learned`/`user`/`assume`/`unknown`），UI 必须可见。
- **冲突并排。** 同字段两个来源不一致时两个都显示并标来源；唯一例外是 `catalog/limits.json` 的 `resolvedConflicts` 里已有人工裁定（当前有 2 条，都是 SenseNova 6.8 的上下文 = 262144：sensenova-6.8-flash 与 sensenova-6.8-flash-lite）。
- **上游 `Retry-After` 优先。** 本地限流只决定「发之前等多久」；已收到的 `Retry-After` 不得被缩短、不得被本地启发式覆盖。AMD 官方原话是「不要自己设定间隔」，我们只加抖动，不加长也不缩短。
- **宁可少发一条，不发一条注定 429 的；宁可 UI 缺一个数，不显示编出来的数。** 缺数据一律 `—` / `(上游未提供)`，**不是 0**、不是 `$0`、不加货币符号；`unknown` 不进图表、不参与聚合、不可排序。
- **不做 OAuth / 网页登录态。** 只支持用户粘贴的 API Key，Key 存 DSH 插件 settings 命名空间，日志/导出/错误上报全部脱敏。
- **不写死时间源。** `Date.now()`/`new Date()`/`setTimeout`/`setInterval` 只允许出现在 `packages/core/src/clock.ts`（可注入假时钟），其余代码一律用注入的 clock（测试 Z-03 会 grep 检查）。
- **不做 TPM 维度**（02 非目标）、**不做主动探针**（不发 `max_tokens:1` 的假请求）、**不把 `/v1/models` 当鉴权/余额探针**（NIM 无鉴权也 200、Agnes 无效 Key 也 200、AMD 计 RPM）。
- **不许** 用 `as any` 绕过类型或跳过夹具；**不许**把测试改成「断言实现怎么写的」而不是「断言上游收到什么」（所有调度夹具断言的是 `Recorder` 里上游收到的请求流）。
- 跨 Provider 自动迁移：**默认关闭**，代码里不出现「顺手跨一下」的分支。

## 我的做事偏好

- 中文回答；代码、标识符、日志用英文。
- 先给结论/状态，再给细节；每批任务结束给「做了什么 / 结果 / 下一步 / 需要我拍板的事」四段。
- 不确定的地方**直接说**「这个我没有出处，标了 assume，需要你确认」，不要用平滑措辞盖过去。
- 遇到规格书自相矛盾或与 DSH 实际 API 不符：**停下来列冲突**让我裁决，不要自行改规格书里的官方数值。
- 小步提交，每完成一个夹具组就 commit 一次，commit message 用 `T-1-b: AMD 429 classifier (A-04..A-08)` 这种格式。
- 第一批做完后，**先别**调 `gh`；等我看过再说是否 `gh repo create dsh-multipool --private --source=. --push`。

现在开始：先读 `docs/00-README.md` 和 `docs/02-CONSTRAINTS.md`，然后按第 1 节向我复述，等我回「继续」再写代码。

---

## 小提示（不属于 Prompt）

- 阶段 2 之后（浮层、看板、另三家 Provider）你可以随时说「继续阶段 2」「先做 SenseNova」，我会**只做当前这一批**再停下来给你看。
- 如果 `docs/05-UI.md` 里的槽位名在你这版 DSH 上不存在，我会先报「环境事实核对失败」，并把 `dsh-doc` 查到的真实签名列给你，而不是硬写一个跑不起来的 UI。
- `02-CONSTRAINTS.md` 里 SenseNova 的 429 语义是「不可归因」，所以那里**没有**任何 RPM 数字——这是刻意的，别让我在实现时「顺手补一个 3 RPM 看着合理」。
