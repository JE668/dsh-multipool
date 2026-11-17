# 01 · PRD（产品需求）

## 1. 一句话描述

`dsh-multipool` 是一个 DeepSeek Harness 插件：把 **AMD Radeon Cloud、NVIDIA NIM、SenseNova、Agnes-AI** 四个 Provider 的**多账号 API Key** 聚合成一个本地池，在请求发出**之前**主动限流、按会话粘性路由、429 时按语义精确退避与迁移，让长时间跑的项目**尽量不中断**，并在左栏与 BI 看板上把「还能用多少」说清楚——**说清楚的部分有出处，不清楚的部分明确标未知**。

## 2. 用户与场景

- **用户**：本机 DSH 的个人开发者；四个 Provider 各持有多个免费/低价账号（一号一个 Key）。
- **场景**：编码代理长时间运行（几十分钟到几小时），会连续发几十到上百次补全请求；额度是按「账号」和「时间窗口」计量的稀缺资源，撞一次 429 就断一段上下文。

## 3. 要解决的问题（按优先级）

| P | 问题 | 现状痛点 |
|---|---|---|
| P0 | 429 频繁，忙时额度还有却被打断 | 多账号没有统一调度，单账号被打爆 |
| P0 | 换 Key 就冷启动，积分/额度消耗反而更高 | 无粘性，请求在 Key 间乱跳，prompt cache 前缀全失效 |
| P1 | 「还有积分为什么 429」说不清 | 不区分 RPM 撞墙 / 并发撞墙 / 日额度耗尽 / 套餐配额耗尽 |
| P1 | 各家限制口径不同，用户记不住 | AMD 双层+7 个头；NIM 仅 40 RPM 且无端点；SenseNova 429 不可归因；Agnes 429/402 分离 |
| P2 | 模型上下架后配置过期 | 模型名写死，遇到 400 `not supported` 才报错 |

## 4. 目标（必须达成）

- **G1** 主动限流：在插件内部按各 Provider 已核实的额度排队，使 429 由「常态」变为「异常」。
- **G2** 会话粘性：同一会话在同一 Provider 上优先固定同一 Key；只有必要才迁移，并统计迁移次数。
- **G3** 精确退避：按 Provider 语义区分 429 类型（AMD 六码、Agnes 429/402、SenseNova 不可分、NIM 仅预算），各自的冷却时长符合约束文档。
- **G4** 可视：左栏常驻图标 + 浮层，展示各 Provider 的额度/额度用量/并发/429 分类计数；BI 看板按 Provider × Model 聚合。
- **G5** 诚实：任何无上游来源的数值一律 `unknown` 呈现，不显示 0、不显示金额符号、不伪造「余额」。
- **G6** 可配：所有阈值、冷却时长、刷新间隔、留存天数可配置，默认值在 UI 上标出来源。

## 5. 非目标（明确不做）

- ❌ 不做 **TPM** 限流维度：AMD 官方限流页只有 RPM / 并发 / 每日 pts；SenseNova、Agnes 文档无 TPM 数值；NIM 无 TPM 端点。UI 不提供「TPM 余额」。
- ❌ 不做**跨 Provider 自动故障转移**：跨 Provider 必然冷启动、前缀缓存全失效，与本插件目的相反。只做「当前 Provider 全 Key 不可用时，提示用户可切换到 X（预计冷启动）」，由用户点确认。
- ❌ 不做**主动探针**去猜上游限额（尤其不发 `max_tokens:1budget` 的假请求）：会消耗真实额度、污染 usage 统计，且 SenseNova 分不清速率与额度，探针可能造成误判。
- ❌ 不做自动充值、自动购买积分包。
- ❌ 不把 `/v1/models` 当作探活或余额探针（NIM 无鉴权也 200；Agnes 无效 Key 也 200；AMD 虽 401 但计 RPM）。
- ❌ 不假设四家 `/v1/models` 结构相同，不为「统一」丢弃有价值的原始字段。

## 6. 支持矩阵（v1）

| Provider | Base URL | Key 形态 | 模型发现 | 用量/额度查询 | 多账号 |
|---|---|---|---|---|---|
| AMD Radeon Cloud | `https://developer.amd.com.cn/radeon/api/v1` | `rc-` | `GET /v1/models`（计 RPM，不占并发） | `GET /v1/usage` + 每次响应头 | ✅ |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | NVIDIA key | `GET /v1/models`（公开可读） | **无** | ✅ |
| SenseNova | `https://token.sensenova.cn/v1` | `sk-` | `GET /v1/models`（正式文档化） | **无**（只能看账户页面/人工录入） | ✅ |
| Agnes-AI（国际站） | `https://apihub.agnes-ai.com/v1` | `sk-`（用户实测，非 `cpk-`） | `GET /v1/models`（实测可用） | **无** | ✅ |

## 7. 验收标准（DoD，摘要；逐条夹具见 07）

1. 单测覆盖 `07-ACCEPTANCE` 的每一条夹具，全部通过。
2. 默认配置下，用「4 个 Provider 各 2 个账号」的假上游跑 30 分钟压测：注入的 429 率 < 3%，且**无一次因迁移导致的额外冷启动**出现在同一会话的非必要迁移里（`migrations_unnecessary === 0`）。
3. 冻结态 UI：对 NIM 与 SenseNova，余额区显示「无端点/本地估算」，**不出现任何货币符号与 0**。
4. 所有默认值都能在 `catalog/limits.json` 找到出处，代码里无内联魔法数字。
5. 左栏图标在窄屏（侧栏收起）时只显示图标 + 角标，`title` 包含「总 429 / 最紧 Provider 剩余 / 可用 Key 数」。
6. 看板在 `main` 与 `shell.overlay` 两种模式都能打开，`Esc` 可从 overlay 退出且数据不丢。
7. Key 明文不进日志、不进看板导出、不进错误上报体。

## 8. 术语

- **粘性（sticky）**：会话与 (provider, key) 的绑定关系。
- **宽限期（grace window）**：收到短暂拒绝后，不立即迁移、而是先等一小段并在**同一 Key** 上重试一次的窗口。
- **准入阈值（admit）**：插件在本地允许自己发出的速率，通常**低于**上游上限，用来换取「不撞 429」。
- **前验（a priori）**：上游在成功响应里就给了数据（如 AMD 的 `X-RateLimit-*` 头）。
- **后验（posteriori）**：只能从失败/成功统计里推断（如 SenseNova 的全部限流）。
