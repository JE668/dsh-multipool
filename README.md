# DSH Multipool

多供应商速率与并发准入插件（DeepSeek Harness 插件）。当前聚焦 AMD Radeon Cloud，并预留 NIM / SenseNova / Agnes / Google 五家供应商的适配框架。

## 一句话

把“发往 AMD 上游的对话请求”接进一个只读的准入闸与指标存储，让 DSH 左栏图标与看板面板看到真实的账户余额、RPM、429 曲线、并发与队列热力；所有数值来源随值走，不编造零。

## 安装

```bash
# 在 DSH 插件目录
pnpm install
pnpm -r build
pnpm -r typecheck
```

在 `~/.dsh/profiles/desktop/package.json` 中把 `dsh-multipool` 的 commit hash 更新到最新 release，然后：

```bash
cd ~/.dsh/profiles/desktop && pnpm install --update-checksums
```

DSH 重启后，左栏会出现 `AMD 账号池` 图标，设置页会出现 `DSH Multipool` 独立节。

## 配置

### AMD Key（必填）

在设置页的 `DSH Multipool` 节填入 `AMD_API_KEY`，保存后点击「测试连接」（只读 `GET /usage`，15s 超时，不留 Key）。

### 账号汇总诊断（T-1-i）

点击「账号汇总诊断」按钮，发送一次 `max_tokens: 1` 的最小对话到 AMD 上游，读取 `X-RateLimit-Limit-User-RPM` / `X-RateLimit-Remaining-User-RPM` 响应头，与本地假设 `Key × 30` 并排对比。60s 内最多点 1 次，结果仅进 UI 与事件流，不参与准入。

### 拒绝开关（T-3-c）

默认关闭：只记录观察，不拒绝任何请求。开启后，预算耗尽时直接返回 429-like 响应，不转发到 AMD 上游。

### 沉浸看板（T-3-e）

默认关闭。开启后面板使用 `shell.overlay` 浮层展开。

### 其他供应商（预留）

`catalog/limits.json` 已收录 NIM / SenseNova / Agnes / Google 五家供应商的限额与适配常量，但目前仅 AMD 有完整拦截实现。其余供应商为适配框架，不主动探测。

## 已知限制

| 供应商 | 限额来源 | 说明 |
|--------|----------|------|
| AMD | docs/02 | RPM 20 / Key 30，concurrent 8（官方文档） |
| NIM | 用户声明 | RPM 40（非官方，由用户提供） |
| SenseNova | 假设 | admitRpm 3，硬上限 30，**无用量端点** |
| Agnes | 文档 | RPM 20，creditsPerUsd 6600（doc-local，待校准），**无用量端点** |
| Google | 未知 | 按模型取值，quotaTimezone America/Los_Angeles，**无用量端点** |

- 不做 TPM，不做跨供应商迁移默认关，不 OAuth，不把 `/v1/models` 当鉴权。
- 看板曲线与表格只持**本进程启动以后**的事件，表上标注「本次启动以后；更早的不在这里。」。
- 空分钟（无请求）在曲线上断开不连线，`rate` 为 `null` 而非 `0.00`。

## 常见问题

**Q: 左栏图标显示 `—/—` 怎么办？**  
A: 说明尚未读取到 Key 或尚未有任何请求通过拦截层。点击「测试连接」确认 Key 可用；等待一条 AMD 对话请求经过拦截层后，图标会更新为真实数值。

**Q: 面板为空？**  
A: 面板数据来自 `ENDPOINT_DASHBOARD`，需要拦截层记录至少一条 AMD 对话事件。首次启动后无数据是正常的。

**Q: 429 拒绝没有生效？**  
A: 确认「拒绝开关」已开启。默认关闭时只观察不拒绝。

**Q: 看板曲线只有 429 占比，没有 RPM？**  
A: 当前面板曲线为 429 占比（0~100）。RPM 由左栏第二行承担（`min(20,30)*0.85/1.5=11`）。

## 测试

```bash
# 核心包（覆盖门栈：Lines ≥85%，Branches ≥80%）
cd packages/core && npx vitest run --coverage

# 插件包
cd packages/plugin-dsh && npx vitest run

# 客户端
cd packages/client-ui && npx vitest run

# 审计
node tools/audit.mjs   # 期望：audit: clean
```

## 文档映射

| 文件 | 内容 |
|------|------|
| `docs/02` | 官方数值（并发 8、RPM 20、contextLength 262144） |
| `docs/05` | 面板与通道设计 |
| `docs/06-TASKS.md` | 任务列表与验收 DoD |
| `docs/07-ACCEPTANCE.md` | 验收夹具 A-01~A-19、Z-01~Z-07、U-01~U-07 等 |
| `docs/08-START-PROMPT.md` | 阶段 0/1 硬约束 |
| `docs/09-AUDIT-LOG.md` | 通道史、审计闸 |
| `docs/10-GAPS.md` | 差距清单 |

## 媒体参考

- `/Users/je/Downloads/AI provider and model/AMD Radeon Cloud API 文档.docx`
- `/Users/je/Downloads/AI provider and model/AMD-RadeonCloud-文档整理.md`
- `/Users/je/Downloads/AI provider and model/AMD-RadeonCloud-Provider-Model-配置速查.md`
