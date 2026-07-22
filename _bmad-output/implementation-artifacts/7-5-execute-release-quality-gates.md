# Story 7.5: 执行发布质量与恢复门禁

Status: review — Scaffolding complete; browser execution pending CI evidence

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 产品负责人,
I want 在发布前获得可重复验收证据,
so that 高风险竞态和灾难恢复不会遗漏.

## Acceptance Criteria

> 以下为 **Epic 级最终验收**（本 Story 的完成标准，非单次迭代）。本次迭代按「先搭骨架再迭代」推进，落地范围见下方《本迭代交付范围》，未覆盖项登记为文档化缺口。

1. **Given** 候选版本准备发布 **When** CI 和验收套件运行 **Then** 性能、20 并发、主旅程、a11y、安全与预算回放均达阈值 **And** 重复账务、不可解释差异和保护池误用均为 0 [Source: epics.md:1087-1090]
2. **Given** 执行备份恢复演练 **When** 模拟数据丢失 **Then** RTO≤4h、RPO≤6h 且证据保存 180 天 **And** 任何阻断项使发布失败 [Source: epics.md:1092-1095]

### 本迭代交付范围（scaffolding-first，boss 2026-07-21 拍板）

**纳入** —— 把当前缺失的可自动化门禁搭成 harness 并接入 CI，逐步迭代，不追求本轮全部达阈值：

- **G1 主旅程 E2E 骨架 (Playwright)** —— 5 条旅程的 harness + 项目配置；至少 2 条真实 smoke 跑通，其余用 `test.fixme`/带 TODO 的占位，CI 中不假绿。对应 AC#1「主旅程」、UX-DR15。
- **G2 自动 a11y 门 (axe)** —— 通过 `@axe-core/playwright` 在关键页面扫描，断言无 `serious`/`critical` 违规。对应 AC#1「a11y」、NFR29「自动化无障碍扫描」。
- **G3 供应商预算回放测试 (vitest)** —— 回放「最坏比赛日」请求序列，断言：日请求 ≤95、普通同步消耗保护额度为 0、超限落 `DEFERRED`、结算保留池不被普通类目侵占。对应 AC#1「预算回放」、NFR42。
- **G4 worker 阵容防重复消耗回归测试** —— 锁定 commit `80fb694` 的耐久 `claimExternalSync` 尝试门（跨重启不重复 `fetchLineups`）。对应 AC#1「保护池误用为 0」、NFR42。
- **G5 性能冒烟 (`scripts/perf-smoke.mjs`)** —— 对缓存读端点顺序请求测 p95，设**宽松**上限做冒烟（非负载测试）。对应 AC#1「性能」、NFR1-NFR3。
- **CI 接线** —— 新增 e2e job（Playwright+axe）+ `test:e2e`/`test:perf` 脚本；预算/worker 测试并入现有 `pnpm test`。流水线顺序对齐 architecture.md:176。

**不做（记为文档化缺口，状态 = 缺口，非 done）：**

- 备份/恢复演练自动化（RTO≤4h/RPO≤6h，AC#2）—— 需生产/基础设施访问 + boss 配合。当前仅有 runbook 手动清单 [Source: docs/runbooks/rapid-launch-2026-07-14.md:75-76,85,141,145]。
- NFR4 **20 并发**负载测试 —— 需引入负载工具（k6/autocannon，仓库当前无）+ 隔离环境。
- NFR1 现场性能（LCP/INP/CLS RUM）与 NFR21 OWASP ASVS L1 **全量**安全扫描 —— 后续迭代；现有 `security-headers.test.ts` + `smoke-test.mjs` 头校验只覆盖一部分。

## Tasks / Subtasks

- [x] **Task 1 — Playwright 主旅程 E2E 骨架 (AC: #1; UX-DR15)**
  - [x] 引入 `@playwright/test`（devDep→`apps/web`；`pnpm install --force` 已装并更新 lockfile）。
  - [x] 新建 `apps/web/playwright.config.ts`：`testDir:"./tests/e2e"`、`testMatch:*.spec.ts`、`baseURL` 用 `PLAYWRIGHT_BASE_URL`(默认 127.0.0.1:3001)、CI 出 list+html+junit 报告、`webServer` `next start`(`reuseExistingServer:!CI`)。
  - [x] 新建 `apps/web/tests/e2e/` + 5 条旅程 spec：注册恢复、邀请入房、封盘竞态、房主运营、超管异常处理。
  - [x] **2 条真实**：注册恢复(3 用例，纯匿名/无 session)+ a11y(5 用例，见 Task 2)+ 超管匿名重定向守卫(1 用例)=**9 个真实用例**；邀请/封盘/房主/超管happy 用 `test.fixme` 真占位(带真实步骤+所需 fixture 注释，**无假断言**)。**偏差**：第 2 条真实选 a11y 而非「邀请入房」——`next start` 生产模式 `fp_session` 变 `Secure`，http 下丢 cookie，认证旅程在 CI 无法建立会话(见 Completion Notes)。
  - [x] 加根/web `test:e2e` 脚本。
- [x] **Task 2 — axe 自动 a11y 门 (AC: #1; NFR29)**
  - [x] 引入 `@axe-core/playwright`。
  - [x] `accessibility.spec.ts` 对匿名可达页(`/`、`/login`、`/register`、`/recover`、`/terms`)跑 axe(wcag2a/aa+wcag21a/aa)，断言无 `serious`/`critical`。**范围偏差**：仅匿名面；比赛列表/详情/房间为认证页，与 Journey 2–5 同一 session 限制，登记为缺口。
  - [x] 与 Story 7.4 a11y 标记协同，只补自动化扫描层，不重造。
- [x] **Task 3 — 供应商预算回放测试 (AC: #1; NFR42)**
  - [x] `apps/worker/src/supplier/budget-replay.test.ts`：真实 `InMemorySupplierBudget` + 真实 `createSupplierJobHandler` + 计数假 client，跑完整比赛日。
  - [x] 断言 NFR42 数值门：30 FIXTURES+50 PREMATCH_ODDS+5 LIVE=85 全 SUCCESS、保护池 10 不被侵占、第 6 条 LIVE→`DEFERRED{retryAt=次日}` 且不 fetch、10 条 SETTLEMENT 用满至 95、第 11 条→`DEFERRED`、总 fetch=95≤95。**本地 vitest 通过**。
- [x] **Task 4 — worker 防重复消耗回归 (AC: #1; NFR42)**
  - [x] 审计发现 commit `80fb694` 已有「跨重启不重复 fetch」计数断言；**新增**命名清晰的 NFR42 回归 `handler.test.ts:220`(与既有 fetchCount 断言互补)。
  - [x] 断言：间隔未到的重复刷新 `SUCCESS synced:0`、`events===["repository.getFixture","repository.claim"]`、**不含** `budget.consume`/`client.lineups`(零预算零供应商)。**本地 vitest 通过**。
- [x] **Task 5 — 性能冒烟 (AC: #1; NFR1-NFR3)**
  - [x] 新建 `scripts/perf-smoke.mjs`（对齐 `smoke-test.mjs`：argv/env base、无三方依赖）。
  - [x] 顺序请求缓存读端点测 p95，**宽松**上限(默认 2000ms)；日志明确「smoke tripwire only — 不断言 NFR1/NFR2/NFR4」。`/api/v1/matches` 仅在给 `PERF_SMOKE_COOKIE` 时探测。
- [x] **Task 6 — CI 接线 (AC: #1)**
  - [x] `.github/workflows/ci.yml` 新增独立 `e2e` job：checkout→pnpm→node24→install→`db:migrate`→`db:seed:super-admins`(best-effort)→`build`→`playwright install --with-deps chromium`→`test:e2e`(含 axe)→上传 playwright-report→perf-smoke(非阻塞)。
  - [x] 决定：**`continue-on-error:true`(非阻塞脚手架)**——本环境无法验证 e2e job 基础设施，先落 harness+报告产物；注释写明「CI 内验证绿后去掉 continue-on-error 转阻塞门」。`test.fixme` 天然跳过不假绿。
- [x] **Task 7 — 文档核对与缺口登记 (AC: #1, #2)**
  - [x] 仅修正 `architecture.md:179` 备份**频率**「每日备份」→「每 6 小时自动备份、保留不少于 7 天」；**未动任何其他架构决策**。
  - [x] 记录：「180 天」= 审计/验收证据(NFR23/NFR42)不变；「7 天」= DB 备份保留(NFR12)；主体不同、非矛盾。
  - [x] 显式缺口登记于 Completion Notes + sprint-status 注释：备份恢复演练自动化 / NFR4 20 并发 / NFR1 现场性能 / NFR21 全量安全扫描。

## Dev Notes

### 现有测试与质量设施（复用，勿重造）

- **唯一 vitest 配置**：`vitest.config.ts`（`environment:node`，`include:["apps/**/*.test.ts","packages/**/*.test.ts"]`，**无覆盖率阈值门**，glob 只含 `*.test.ts` 不含 `.tsx`——现有 70+ 测试均为 `.ts`，新 e2e **不要**用 `.test.ts` 命名以免被 vitest 误收，放在 `tests/e2e/*.spec.ts` 由 Playwright 独立管理）。[Source: vitest.config.ts:5-7]
- **CI**：`.github/workflows/ci.yml` 单 `verify` job：checkout→pnpm(10.4.0)→node24→`install --frozen-lockfile`→`verify:workspace`→迁移幂等 smoke（跑两次 `db:migrate` 后比对 `.sql` 数 vs `app_schema_migrations` 行数）→`lint`→`typecheck`→`test`→`build`。**无任何 e2e/a11y/perf 步骤**。[Source: .github/workflows/ci.yml:36-64]
- **smoke-test.mjs**：匿名 GET 冒烟（`/`、`/api/health/live`、`/api/health/ready`、`/api/v1/auth/session`=401、6 项安全头），**仅** `smoke.yml` 手动触发，未进 `ci.yml`。新 `perf-smoke.mjs` 照此风格。[Source: scripts/smoke-test.mjs:47-81]
- **预算模型**：`packages/domain/src/supplier-budget`（类目基线 STATIC 30 / LIVE 5 / PREMATCH_ODDS 50 / SETTLEMENT 保留；`consume()` 返回 `CATEGORY_EXHAUSTED`/`PROTECTED_RESERVE`/`HARD_LIMIT`）；worker 端 charge/deferral 在 `apps/worker/src/supplier/handler.ts`。回放测试直接跑这套逻辑，无需 mock 网络。
- **阵容防重复消耗**：commit `80fb694` 已加耐久 `claimExternalSync` 尝试门（`apps/worker/src/supplier/handler.ts:166,177`），并含 handler/scheduler 两处耐久测试。Task 4 在其上补命名回归即可。

### 技术栈与门禁工具选型

- 栈：Next.js 16.2 / React 19.2 / Node 24 / PostgreSQL 18 / pnpm 10.4 / Vitest 3.2。[Source: architecture.md:87,89]
- E2E = **Playwright**（架构指定：architecture.md:96,176,242；UX-DR15 明确「Playwright smoke」）。**净新引入**，仓库当前无。
- a11y 扫描 = **@axe-core/playwright**（与 E2E 复用同一浏览器会话，契合 NFR29「自动化无障碍扫描 + 一次人工键盘/屏幕阅读器检查」）。
- 负载/perf 工具（k6/autocannon/artillery/lighthouse）当前**全无**；本轮只做无依赖的 `perf-smoke.mjs`，重型负载工具留到 NFR4 迭代。

### 架构测试标准（必须遵循）

- 测试与源码 co-located，命名 `*.test.ts(x)`。[Source: architecture.md:199]
- 强制门（architecture.md:242）：TS strict、ESLint boundary rules、迁移检查、OpenAPI contract test、ledger invariant property test、并发 integration test、Playwright 主旅程 smoke。本 story 补齐其中缺失的 **Playwright 主旅程 smoke**（+ a11y/预算回放）。
- 涉及 ledger/封盘/配额/结算 → 必须并发/幂等 integration test。[Source: architecture.md:397]
- 部署：web standalone + worker bundle、同一 git SHA；迁移 expand/contract 兼容、先行校验。[Source: architecture.md:347-348]。部署供应商架构未固定（Render 仅见于 runbook/render.yaml）。[Source: architecture.md:369]

### 关键 NFR 阈值（供门禁断言引用）

- NFR1 移动端 p75：`LCP≤2.5s / INP≤200ms / CLS≤0.1`。[Source: prd.md:889]
- NFR2 缓存读 `p95≤800ms`；NFR3 提交/冻结/拒绝 `p95≤1s`（均在 NFR4 负载下）。[Source: prd.md:890-891]
- NFR4 ≥20 用户 10s 内并发提交，重复单/重复冻结为 0。[Source: prd.md:892]（本轮**缓期**）
- NFR12 备份≥每 6h、保留≥7 天、RTO≤4h/RPO≤6h。[Source: prd.md:903]
- NFR21 OWASP ASVS 5.0 L1、无 Critical/High。[Source: prd.md:915]（全量扫描本轮缓期）
- NFR29 自动化 a11y 扫描 + 一次人工键盘/屏幕阅读器检查。[Source: prd.md:926]
- NFR42 发布前回放清单 + 通过标准（重复账务 0 / 差异 0 / 保护额度普通消耗 0 / 日请求≤95 / 备份恢复满足 NFR12 / 证据≥180 天）。[Source: prd.md:945]

### ⚠️ 需 boss/architect 定夺的文档问题（Task 7，勿静默改）

- **备份频率不一致**：`architecture.md:179`「数据库每日备份」 vs `prd.md:903`(NFR12)+`runbook:75`「每 6 小时」。
- **非矛盾澄清**：180 天 = 审计/验收证据（NFR23 prd.md:923、NFR42 prd.md:945）；7 天 = DB 备份保留（NFR12）。主体不同。

### 反模式 / 防坑

- 别把 e2e spec 命名成 `*.test.ts`（会被根 vitest glob 抓取）。用 `tests/e2e/*.spec.ts`。
- 别在请求路径引入真实供应商调用；预算回放走内存模型 + handler，不打 API-Football。
- `fixme` 占位必须是真占位（`test.fixme`），禁止空断言假绿——boss 明确「不假绿」。
- Playwright 需要 app + PG；CI 里复用现有 `postgres:18` service（ci.yml:15-28）与 test env（ci.yml:29-34），勿另起库。

### Project Structure Notes

- 新增：`apps/web/playwright.config.ts`、`apps/web/tests/e2e/*.spec.ts`（新目录，architecture.md:277 规定落点）、`scripts/perf-smoke.mjs`、`apps/worker/src/supplier/budget-replay.test.ts`。
- 修改：`.github/workflows/ci.yml`（+e2e job）、根 `package.json`（+`test:e2e`/`test:perf`）、`apps/web/package.json`（Playwright devDep + `test:e2e`）。
- 对齐统一结构：测试 co-located 原则对单测成立；e2e 作为跨端旅程测试独立放 `apps/web/tests/e2e`（架构既定），非 co-located，属既定变体。

### References

- [Source: epics.md:1077-1095] — Story 7.5 用户故事与 AC
- [Source: epics.md:993-1076] — Epic 7 目标 + 7.1/7.2(done)/7.3(in-progress)/7.4(done) 交叉上下文
- [Source: epics.md:176] — UX-DR15：五条旅程 Playwright smoke（注册恢复/邀请入房/封盘竞态/房主运营/超管异常）
- [Source: prd.md:889-893] — NFR1-NFR5（性能/并发/结算可见）
- [Source: prd.md:903-904] — NFR12（备份/RTO/RPO）、NFR13（可用性 99%）
- [Source: prd.md:915,926,945] — NFR21（安全）、NFR29（a11y）、NFR42（发布回放门 + 证据 180 天）
- [Source: architecture.md:96,176,199,242,277,346,370,397] — 测试栈/CI 顺序/co-located/强制门/e2e 落点/性能环境延后
- [Source: .github/workflows/ci.yml:12-64] — 现有 CI verify job
- [Source: scripts/smoke-test.mjs:13-97] — 现有 HTTP 冒烟脚本
- [Source: vitest.config.ts:5-7] — 唯一 vitest 配置（无阈值门）
- [Source: docs/runbooks/rapid-launch-2026-07-14.md:75-76,85,141,145] — 备份/RTO/RPO/恢复验证（手动）
- [Source: commit 80fb694] — worker 耐久 claimExternalSync 尝试门（Task 4 回归对象）

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (星期五 / dev-story)

### Debug Log References

- **本地 `node_modules` 被 iCloud 同步损坏**（项目位于 `~/Desktop`）：`picomatch/lib/scan.js` 数据块不可读(`tail: Undefined error`)、`fdir/dist/index.js` 缺失、`.pnpm/` 下 343 个 `xxx 2` 冲突副本目录 → `vitest` 无法 glob 测试文件(`TypeError: scan is not a function`)，**整套本地测试瘫痪**。普通 `pnpm install` 不修（不校验已存在包内容）；**`pnpm install --force`** 从完好全局 store 重新解包修复。纯本地问题，CI 干净安装不受影响。
- **全量 `pnpm test` 的 8 个失败均为环境所致，非本 story 代码**：(1) `packages/db/.../schema.test.ts` 1 条 DB 集成测试需活的 Postgres（本地 `DATABASE_URL` 未设、55432/5432 均关）→ 5s 超时；(2) 其余 7 个 suite 在 206s 长跑中被 iCloud **中途驱逐** `packages/db/dist/supplier/budget.js`(跑完确认该文件消失)→ vitest 模块加载超时。重建 packages 后单独重跑这 7 个 suite **40/40 全过(1.6s)**，证实为 dist 驱逐而非代码/PG 依赖。这两类在 CI(Linux 干净构建 + postgres:18 service)均通过。

### Completion Notes List

**交付（scaffolding-first，boss 2026-07-21 拍板范围）**
- **G1/G2/G3/G4/G5 + CI 接线 + Task 7 文档修正全部落地。** 见 Tasks 勾选。
- **本地已验证（可运行项全绿）**：`pnpm typecheck`(9 projects)=0、`pnpm lint`(web，含 6 个 e2e spec)=0、G3+G4 `vitest`=**15/15**；全量 `vitest` 在 dist 完好时 **322/323**（唯一未过=需活 PG 的 DB 集成测试）。
- **G3 结构可赋值性确认**：域 `BudgetSnapshot.usedByCategory: Record<Category,number>` 可赋值给 handler `SupplierBudgetPort` 的 `{LIVE:number;[k:string]:number}`（`Record` 带隐式字符串索引签名），`tsc` 通过——首个把真实域 `InMemorySupplierBudget` 喂进 handler 端口的测试。

**环境阻塞（按 boss 指示登记为阻塞，非"通过"）**
- **E2E 浏览器执行**：本沙箱无法下载 Playwright 浏览器 / 启动应用 / 跑真实认证流程 → 6 个 spec **未在本地执行**，交 CI/boss 机器跑。**未把任何 e2e 标为本地通过。**
- **`next start` 生产 `Secure` cookie 陷阱**：CI e2e job 用生产 `next start`，`fp_session` 带 `Secure`，`http://127.0.0.1` 下不回传 → 认证旅程(邀请入房/封盘/房主/超管 happy)在该服务器下无法建会话。故这 4 条为 `test.fixme`，注释指明去 fixme 需跑 `next dev`(NODE_ENV=development) 或把 cookie Secure 做成可配(属产品改动，本 story 不做)。真实可跑的 2 条(注册恢复/a11y)不依赖会话，`next start`/`next dev` 均可过。
- **CI e2e job 先 `continue-on-error`**：本环境无法验证该 job 的 PG/浏览器基础设施，先落 harness + 报告产物；CI 内实测绿后应去掉 `continue-on-error` 转为阻塞门（已在 yaml 注释标注）。

**显式缺口（状态=缺口，非 done；AC#1/#2 未完全覆盖）**
- 备份/恢复演练自动化（RTO≤4h/RPO≤6h，AC#2）——需生产/基础设施访问 + boss 配合。
- NFR4 **20 并发**负载（需 k6/autocannon 等，仓库当前无）。
- NFR1 现场性能（LCP/INP/CLS RUM）。
- NFR21 OWASP ASVS L1 **全量**安全扫描。
- a11y **认证页**扫描（比赛列表/详情/房间）——与上文会话限制同源，随认证 e2e 一并推进。

**硬约束遵守**：未 `git push`、未合并 `main`；`architecture.md` 只改备份那一条 clause（频率 每日→每 6h **+ 保留期≥7 天**，按 boss 逐字指定的替换文本「每 6 小时自动备份，保留不少于 7 天」；同一句里 migration check / expand-contract 等其它内容一字未动），未顺带改其它架构决策；180 天审计证据保留不变。

### File List

**新增**
- `apps/web/playwright.config.ts`
- `apps/web/tests/e2e/registration-recovery.spec.ts`（真实，3 用例）
- `apps/web/tests/e2e/accessibility.spec.ts`（真实，G2，5 用例）
- `apps/web/tests/e2e/invite-join-room.spec.ts`（`test.fixme` 占位）
- `apps/web/tests/e2e/closing-race.spec.ts`（`test.fixme` 占位）
- `apps/web/tests/e2e/host-operations.spec.ts`（`test.fixme` 占位）
- `apps/web/tests/e2e/super-admin-exception.spec.ts`（1 真实守卫 + `test.fixme` happy）
- `apps/worker/src/supplier/budget-replay.test.ts`（G3）
- `scripts/perf-smoke.mjs`（G5）
- `apps/web/src/features/auth/auth-error-messages.ts`（post-review i18n 修复：错误码→中文纯解析器）
- `apps/web/src/features/auth/auth-error-messages.test.ts`（post-review：错误码契约单测，本地 vitest 2/2 绿）
- `packages/db/src/identity/repository.test.ts`（CI run1 后：重复注册唯一冲突映射回归，4 例，本地 vitest 绿）

**修改**
- `apps/web/src/features/auth/auth-form.tsx`（post-review i18n 修复：改走 `authErrorMessage`，移除误键 map 与英文 `error.message` 兜底泄漏）
- `apps/web/tests/e2e/registration-recovery.spec.ts`（post-review：重复用户名用例补断本地化文案）
- `packages/db/src/identity/repository.ts`（CI run1 后：`isUniqueViolation` 沿 `.cause` 链 + 消息探测，修重复注册 500→409）
- `apps/web/tests/e2e/accessibility.spec.ts`（CI run1 后：goto `networkidle` + 扫描 context-destroyed 重试，修 KickoffLoader 竞态）
- `apps/worker/src/supplier/handler.test.ts`（G4：追加 NFR42 零消耗回归用例）
- `apps/web/package.json`（+`@playwright/test`、`@axe-core/playwright` devDep；+`test:e2e` 脚本）
- `package.json`（+`test:e2e`、`test:perf` 脚本）
- `.github/workflows/ci.yml`（+`e2e` job，先 `continue-on-error`）
- `_bmad-output/planning-artifacts/architecture.md`（仅备份频率一行）
- `pnpm-lock.yaml`（`pnpm install --force` 新增两个 devDep）
- `_bmad-output/implementation-artifacts/sprint-status.yaml`（7-5 → review + 缺口注释）
- `_bmad-output/implementation-artifacts/7-5-execute-release-quality-gates.md`（本文件：Tasks/Dev Agent Record）

### Review Findings

_(bmad-code-review 2026-07-22；3 层并行对抗评审：Blind Hunter（仅 diff）/ Edge Case Hunter（diff + 源码只读）/ Acceptance Auditor（diff + spec）。**0 Critical/High 违规残留；6 项诚实约束经独立验证全部满足；G3/G4 被两个 reviewer 各自独立重跑均 15/15**。)_

**已应用修复 (patch)**

- [x] [Review][Patch] 重复用户名 E2E 断言了应用**未渲染**的文案（真实测试会在 CI 失败）→ 先改为断言错误标题「未能完成」+ 仍停留在注册表单（无 receipt）；随后下方 i18n 修复落地，进一步补断本地化文案「这个用户名已被使用，请换一个。」现真实、精确、可通过。[apps/web/tests/e2e/registration-recovery.spec.ts]
- [x] [Review][Patch] CI perf-smoke 步骤在 e2e 步骤失败时被隐式 `if:success()` 跳过（job 级 `continue-on-error` 不改变步骤条件）→ 加 `if: always()`，使 G5 冒烟在「e2e 尚未转绿」这一正是它存在的场景下仍会跑（自身失败仍靠 `|| echo` 非阻塞）。[.github/workflows/ci.yml]

**本轮追加修复 (post-review，boss 拍板顺序 C：先修 i18n 再进 CI/push)**

- [x] [Fixed] **认证错误码映射 i18n 不一致**（真实用户可见 bug，gate 首个匿名旅程即捕获）：UI `auth-form.tsx` 旧 errors map 键 `USERNAME_TAKEN`/`RECOVERY_CODE_INVALID`/`VALIDATION_ERROR` 与 API **逐字返回**（`handlers.ts:97`）的实际码 `USERNAME_UNAVAILABLE`（`repository.ts:38`）/`INVALID_RECOVERY_REQUEST`（`service.ts:219,233`）/`INVALID_REQUEST`（`handlers.ts:98`）不匹配，且兜底顺序先落英文 `error.message` → 中文站显示英文。**修复**：抽出纯解析器 `auth-error-messages.ts`——登录/注册/恢复三模式可返回的 9 码全量映射中文（`INVALID_CREDENTIALS`/`USERNAME_UNAVAILABLE`/`RULES_CONFIRMATION_REQUIRED`/`INVALID_USERNAME`/`INVALID_PASSWORD`/`INVALID_RECOVERY_REQUEST`/`RATE_LIMITED`/`INVALID_REQUEST`/`INVALID_ORIGIN`），未知码一律中文兜底、**永不泄漏**英文 server message；`auth-form.tsx` 改走 `authErrorMessage(result.error?.code)`；新增 co-located 契约单测 `auth-error-messages.test.ts`（枚举全部码断言本地化 + 未知码断言中文兜底，本地 vitest **2/2 绿**）；重复用户名 E2E 补断本地化文案。web typecheck/lint/单测本地绿。[apps/web/src/features/auth/{auth-error-messages.ts, auth-error-messages.test.ts, auth-form.tsx}]

**转独立任务 / 缺口 (defer)**
- [x] [Review][Defer] CI e2e job `continue-on-error:true` 使真实 spec 目前只是 advisory、不具强制门作用——boss 拍板 scaffolding-first，yaml 注释 + Completion Notes 均有「CI 内验证绿后去掉转阻塞」TODO（即强制化触发点）。
- [x] [Review][Defer] a11y 扫 `/` 可能在客户端 `loadSession` 完成前扫到 `KickoffLoader` 骨架（`waitUntil:load` 早于水合）——非失败，但被扫 DOM 不确定；后续可等落地页稳定元素。[apps/web/tests/e2e/accessibility.spec.ts]
- [x] [Review][Defer] CI seed 步骤在 CI 中实际空跑（e2e job env 未设 `SUPER_ADMIN_*`）——与 journey 5 为 fixme 一致，`|| echo` 已容忍。
- [x] [Review][Defer] `playwright.config` 端口推导：无端口的远程 `PLAYWRIGHT_BASE_URL` 会误起本地 3001——CI/默认(3001) 不受影响。[apps/web/playwright.config.ts:6]
- [x] [Review][Defer] `invite-join-room` 手工 `newContext` 将来 un-fixme 且中途失败会泄漏 context（当前 fixme 无影响，un-fixme 时改 try/finally 或 fixture）；perf-smoke `SERVER_PID` 捕获的是 pnpm 包装进程而非 next（ephemeral runner 无害）、非数字 env 会 NaN（仅误配置）。

**已驳回误报 (dismiss，5 项)**：① budget-replay 端口字面量漏 lineup/getFixture/claim 成员会破 typecheck——**假**，handler 端口这些成员为可选（`handler.ts:31,39-43`），全量 typecheck 实跑=0；② `totalFetches()==95` 的耦合是 bug——**假**，handler 的 RESULTS 分支走 `fetchFixtures`（`handler.ts:123-129`），实跑通过；③ 保护额度包含边界 off-by-one——域码（`supplier-budget/index.ts:83,87,90`）+ 实跑证伪；④ perf-smoke `/` 用 `redirect:manual` 会误报——`/` 实为 200 非重定向（Edge Case Hunter 证实）；⑤ 选择器唯一性 / `setup(claimStore)` / CI env 完整性 / 路由可达性——Edge Case Hunter 逐一对源码证实无误。

### CI 实证 (PR #1, run 29897407739, 2026-07-22)

**`verify` 作业全绿**：lint / typecheck / `pnpm test`（含 auth i18n 契约测试）/ build / 迁移冒烟幂等。i18n 解析器由单测证明正确。

**`e2e` 作业红**（`continue-on-error`，故 run 整体仍 success）：16 用例 = **3 真实通过**（注册成功 / 恢复轮换 / 超管匿名守卫）+ **7 `test.fixme` 跳过** + **6 失败**。6 失败均非 i18n 映射问题，分两类，本轮全部修复：

- [x] **a11y 5 条（脚手架时序，非真实违规）**：axe `analyze()` 报 `page.evaluate: Execution context was destroyed ... because of a navigation`；失败截图显示页面停在 **KickoffLoader「KICK OFF」开屏**——扫描撞上开屏→内容跳转、根本没跑完，不是页面真有 serious/critical 违规（正是上方 line 207 defer 预警的 KickoffLoader 竞态被 CI 证实）。**修复**：`accessibility.spec.ts` goto 改 `waitUntil:"networkidle"`，并加 `analyzeAccessibility()` 在 context-destroyed 时等 networkidle 后重试（真实违规仍作为结果触发断言失败，不被吞）。
- [x] **重复用户名 1 条 = 真·后端 bug（E2E 门禁首次即逮住）**：失败截图（attempt+retry 各一张）错误框显示通用兜底「暂时无法完成，请稍后重试。」而非 `USERNAME_UNAVAILABLE` 的中文 → 说明 API 对重复注册返回**未映射码（`INTERNAL_ERROR` 500）而非 409**。根因：`repository.ts` 的 `isUniqueViolation` 只查顶层 `error.code==="23505"`；drizzle-orm 0.45.2 包裹查询错误（真实 PG code 落在 `.cause`）时漏判 → 原始错误重抛 → `handlers.ts:99` 返回 500。**修复**：`isUniqueViolation` 改为沿 `.cause` 链探测 + 消息兜底（`duplicate key value violates unique constraint`），重复注册遂返回 409 `USERNAME_UNAVAILABLE`，前端显示「这个用户名已被使用，请换一个。」。`DrizzleIdentityRepository` 此前**零测试**、`verify` 的 domain 服务测试用 mock repo 未覆盖真实错误检测→bug 潜伏至今；补 `repository.test.ts` 4 例锁定顶层码/包裹码/消息/非唯一错误，本地 vitest 绿。

三项修复本地全绿（新增/改动共 6 单测通过 + db&web typecheck + web lint）；随本提交 push 触发 **CI run 2** 实证浏览器 E2E。**7.5 仍 `review`**，待 run 2 的 e2e 结果再定 `done`。
