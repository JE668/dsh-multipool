# 第一批缺口清点

对第一批 11 项（`docs/08-START-PROMPT.md`）逐条实测，状态截至 `04fd646`。
写这份的依据是代码与测试，不是任务清单的自述。

## 四种状态，不互相代替

| 状态 | 意思 |
|---|---|
| 有测试 | 仓里有一条测试，在夹具 `Given` 下会失败。绿 = 这一句验过 |
| 无测试 | 代码可能有，但没有任何东西会因为这句不成立而变红 |
| 无实现 | 追到底层，没有一行代码执行这句描述的行为 |
| 需真机 | 只能装进 `~/.dsh/profiles/` 后观察，仓内测试绿红都不作数 |

夹具号出现在注释里、测试名沾到同名关键词，都不算有测试。

## 逐条

| 夹具 | 在批内 | 状态 | 依据 |
|---|---|---|---|
| A-01 ~ A-06 | 是 | 有测试 | `packages/core/test/amd-*.test.ts` |
| **A-07** | 是 | 收窄后仍**未接线** | 见下 §1 |
| A-08 ~ A-18 | 是 | 有测试 | 同上 |
| A-19 | 否（依赖 T-2-c） | 展示侧无实现 | 见下 §2 |
| U-01 ~ U-04 | 是 | 有测试 | `packages/core/test/amd-*.test.ts` |
| U-05 | 否（依赖 T-3） | 部分覆盖 | 见下 §3 |
| D-01 / D-02 | 是 | 有测试 | `packages/core/test/amd-metrics.test.ts` |
| C-01 ~ C-03 | 是 | 有测试 | `packages/core/test/amd-settings.test.ts` |
| Z-01 | 否 | 无实现 | 禁 `as any` 没有 lint 规则 |
| Z-02 | 否 | 实测通过 | 见下 §4 |
| Z-04 ~ Z-06 | 否 | 未做 | 迁移 / 端口热生效 / 卸载干净 |

在批内 21 条里，**20 条有测试，1 条（A-07）有映射层但调度器不调它**。

## §1 A-07 收窄了，收窄后那一半也没接线

夹具写的是「3 个账号同出口 IP，账号 2 触到 IP 限流 ⇒ **三个账号** 60s 内都不发请求」。
这一句在 `04fd646` 里被收窄成「**那一个**账号 60s 内不发请求，原因记作 `rpm_ip` 而不是 `rpm_key`」，
理由写在 `docs/07-ACCEPTANCE.md` 的 A-07 引用块里：本机看不到自己的出口 IP 后面共了几个账号，猜错的代价是把一个本可用的账号也停掉。

收窄后的四半：

| 半张 | 内容 | 现在 | 证据 |
|---|---|---|---|
| 分类 | `ip_rate_limit_exceeded` 归为 `rpm_ip` | 已做 | `packages/core/src/amd-error.ts:192`；A-04 已测 |
| 映射 | 把 `rpm_ip` 写进**这一个**账号的 `cooldownReason`，长度就是上游的 `Retry-After` | 已开一层 | `packages/core/src/cooldown.ts`；`packages/core/test/amd-cooldown.test.ts` 5 例 |
| 接线（代理层） | `handleProxyRequest` 分类完一个响应，把类型交给 `deps.note(accountAlias, rateClass)` | 已做，见 `packages/core/src/proxy.ts`；`packages/core/test/amd-proxy-note.test.ts` 4 例（反向验证：去掉 note 只红 1 条，把 rpm_ip 报成 rpm_key 红 2 条） |
| 接线（持有者） | 谁持有 `Account[]`，谁就调 `accountAfterVerdict` 实施转变 | **未做** | `proxy` 不持有账号池，它只通知；目前全仓无人实现 `note` |
| 广播 | 同出口 IP 的其他账号一起冷却 | **不做** | `04fd646` 的收窄理由 |

所以 `rpm_ip` 仍只是一个**名字**：给单个账号的冷却原因贴的标签。现在两行代码会把它带到应用层：
`proxy.ts` 在每个响应上算它并通知持有者，`cooldown.ts` 把它写成账号的状态。
**但两者之间还缺一个实现 `note` 的持有者**——因此 `accountAfterVerdict` 在真实路径上仍无调用方；
`packages/core/test/amd-snapshot.test.ts` 里那个手写的 `cooldownReason: 'rpm_key'` 依然是库里唯一一处被赋值的地方。
两半都写好了、只是没有人把它们接起来，与“两半都没写”在测试里是一回事——这是这一段最容易下滑的地方。

同时暴露一处归属缺失：`docs/06-TASKS.md` 把 A-07 挂在 `[T-1-b/T-1-e]` 下，但 T-1-b 只要求
「分类器把 code 归到 rpm_ip」（做了），T-1-e 没提跨账号熔断。**没有任何任务说自己要做 A-07 的后半句**。

## §2 A-19 数据侧可辨，展示侧没载体

- 四个值在 `packages/core/src/contract.ts:230` 的 `RateKind` 里，分类器侧可辨。
- `packages/core/src/amd-error.ts:191-192` 有一段注释把这件事说得很准，紧接着是
  `return 'rpm_ip'`：

  ```
  // ip_rate_limit_exceeded also quotes 60, but it is not a Key window: the whole egress IP is
  // blocked, so every account behind it must stop, not just this Key (02 section 1.4).
  ```

  注释说"每一个账号都要停"，返回的却只是一个字符串，供下面给**这一个**账号贴标签。
  注释里那句 `every account ... must stop` 在代码里没有下文。
- `packages/core/src/snapshot.ts:181` 把 `cooldownReason` 原样带上线，`:254` 填进 `CoolingEntry.rateKind`。
- 但「浮层显示具体原因与剩余秒数」的浮层不存在：`client.js` 只有 `SidebarIcon` 与
  `MultiPoolPanel` 两处注册。浮层是 T-2-c，第一批不含。

性质：验收词挂在了比它能被验的阶段更早的位置。第一批做到 T-2-b 为止，A-19 到不了。

## §3 U-05 是部分覆盖，不算过

`serializeSnapshot`（`packages/core/src/snapshot.ts:289`）确实过了 `scrubSecrets`，
`packages/core/test/amd-snapshot.test.ts` 也断言了输出含 `1a2b` 不含完整键。

但夹具说的是**看板导出 JSON**，看板（T-3-*）还没有。现在是同一条脱敏路径被一个更小的出口验过。
等 T-3 起来，那份导出若复用 `serializeSnapshot`，U-05 才算真过；若自己拼 JSON，这条测试保不住它。

## §4 Z-02 跑过之后是个真闸门，但它守的是平均值

`packages/core/vitest.config.ts` 写着 `thresholds: { lines: 85, branches: 80 }`，此前从没执行过。
2026-11-21 实跑 `npx vitest run --coverage`：**退出码 0**，All files 行 92.89 / 分支 84.84。
闸门确实执行了（此前没人执行过），当前达标。**不达标会怎样我没验** — 那属 vitest threshold 的既定行为，我没压红试一次；要写"会拦"得先跑一次，否则只能说"跑得起、现在过"。

但它守不住下面这种：

```
contract.ts      55.55 |  33.33 | 25 | 55.55
```

`contract.ts` 的分支覆盖率是 33.33 — 就是说两个分支里只有一个被走过 — 而总闸门安然通过，
因为汇总的 84.84 被 `secret.ts`(100)、`retry-after.ts`(95) 这些拉起来了。**汇总阈值从不阻止单个文件躺平**，
它只阻止"平均下来躺平"。这是这套配置的已知形状，不是 bug，但读 `audit: clean` 那行字的时候要知道它守的是哪个。

真要守单文件，得给 vitest 配 `thresholds: { perFile: true }`；那时 `contract.ts` 立刻红，
而它大部分是类型声明加两个运行时辅助，per-file 的 80 未必合理。这条**留给你拍**，我不擅自动。

## §5 完成定义另两条

- 「左栏图标在本机 DSH 显示绿/灰两态」——**需真机**，且需要先装进 profile。仓内能证的只是
  `ctx.slots.inject('sidebar.panellist')` 与 `main` 用同一个 id 成对注册（`test/client-loader.test.mjs`）。
- 「`FakeUpstream` 跑 30 → 20 放行、无 429」——仓里 `packages/core/test/admission.test.ts` 有窗口级放开/收紧的用例，
  但那是**逐条断言**，不是一次 30 请求的回放。两者不等价：前者证每条规则，后者证规则串起来不会在第 21 次发飙。
  这条现在没有载体，属**无测试**。

## §6 写完 A-07 才发现：S 系列没有"全绿"这种状态可查

`docs/06-TASKS.md` 的 T-1-f 写着：

> **DoD**：04 §9 的 S-01 ~ S-08 全绿（假时钟注入，不打真网）。

这句在本仓无法被证实，也无法被证伪：

1. `docs/07-ACCEPTANCE.md:272-278` 的 S 组只有一行——「S-01…S-20 与 `04-SCHEDULER.md §9`
   表格逐行对应，实现时以该表为准逐条补 fixture」。没有逐条展开的验收词，没有可勾的条目。
2. `packages/core/test` 下 22 个文件、288 条测试，**没有一条用例名带 S 编号**。唯一例外是
   `clock.test.ts:143` 的一句注释，而它讲的 `pendingTimeoutCount` 不是 S-01 的内容。
3. 所以 grep `S-06` 得 0 不能说明 S-06 没测：`amd-scheduler.test.ts` 通篇按**机制**命名
   （`breakers` / `leastLoad` / `migration table` / `sticky pick`），从不带编号。

**这是比 A-07 更靠上的病**：A-07 是活没干，这里是"干没干"没有记录方式。T-1-f 是第一批 11 项之一，
它的 DoD 就落在这种状态上。

我能确定的是：S-06（`ip_rate_limit_exceeded` ⇒ **同出口 IP 全部 Key** 冷却 60s，不同 IP 不受影响）
**没有对应测试**。按语义扫过 288 条用例名，最接近的是 `migration table` 的
"only rpm_ip, daily_quota and auth may move a session"——那测的是**迁移权限**（这几种可搬会话），
不是**广播冷却**（一个 Key 撞 IP 限，同 IP 的 Key 一起停）。与 §1 对 A-07 的判断同源：
`07` 的 A-07 与 `04 §9` 的 S-06 是同一需求的两处写法，两处都没有实现。
