# Architecture Decision Document

> Written 2026-07-13, before implementation. It records the decisions the code was
> built to, so where the two disagree the code is the current truth and this is the
> reasoning that got there. The planning documents it was derived from are not part
> of the published repository.

_本文档是 Football Predictor 实现阶段的技术决策与一致性约束来源。PRD 定义产品规则，本文档定义如何可靠实现。_

## 1. Project Context Analysis

### Requirements Overview

**Functional Requirements**

PRD 包含连续编号的 FR1–FR72，覆盖九个架构域：身份与访问、比赛与赔率、预测单、私人房间与邀请、房间积分账本、封盘与结算、外部数据预算、超级管理员运营、合规与用户可见状态。系统不是现金博彩平台，不接收存款、提现或可兑现资产。

**Non-Functional Requirements**

NFR1–NFR42 的主要驱动因素是：移动端 PWA、WCAG 2.2 AA、弱网可恢复交互、强一致积分与冻结、并发提交单写入、结算幂等、可审计冲正、API-FOOTBALL 每日 95 次预算、故障降级、隐私与体育数据授权边界。

**Scale & Complexity**

- Primary domain: 响应式全栈 Web/PWA + 后台任务 + 第三方体育数据集成
- Complexity level: 中高；页面数量有限，但财务式积分账本、赛时状态机和受限外部配额显著提高后端复杂度
- Architectural components: Web/PWA、HTTP API、领域服务、PostgreSQL、后台 Worker、API-FOOTBALL Adapter、管理控制面、可观测性
- Multi-tenancy: 私人房间是轻量租户边界；同一用户在不同房间拥有独立余额与排名
- Real-time: Phase 1 使用条件请求与轮询，不引入 WebSocket

### Technical Constraints & Dependencies

1. API-FOOTBALL 是外部赛程、赔率、开球与赛果来源；所有调用必须穿过单一 Adapter 和原子预算守卫。
2. 每日总预算 95 次，其中 10 次为结算保护额度；缓存和供应商状态必须可观察。
3. 预测提交、冻结、结算、冲正必须位于数据库事务内，不得由客户端计算余额。
4. 封盘依据权威 kickoff 与 server time；实际开球变化不得反向开启已封盘市场。
5. Phase 1 不依赖消息中间件、Redis 或 WebSocket；优先减少单开发者运维面。
6. 生产仅运行受支持的 Node.js LTS 与 PostgreSQL 主版本；依赖锁文件固定实际小版本。

### Cross-Cutting Concerns Identified

- RBAC 与房间级授权
- 审计日志与隐私脱敏
- `match/market/ticket/settlement` 状态机
- 钱包式双分录/追加式积分流水
- 幂等键、乐观/悲观并发控制
- 外部数据新鲜度、配额预算、缓存与降级
- 时区统一、UTC 存储、本地化展示
- 可访问性、响应式与弱网恢复
- 合规文案与体育数据授权开关

## 2. Starter Template Evaluation

### Primary Technology Domain

采用 TypeScript monorepo：Next.js App Router 承载 Web/PWA 与 REST Route Handlers，独立 Node.js Worker 运行同步、封盘、结算和重试任务，共享领域包与数据库包。

### Options Considered

1. **单体 Next.js + 平台 Cron**：起步快，但后台任务的长执行、幂等重试和部署平台绑定较强。
2. **Next.js + NestJS + Redis Queue**：边界清楚，但 Phase 1 运维和样板量偏大。
3. **Next.js + PostgreSQL-backed Worker（选定）**：保留单体部署简洁度，同时将定时任务与请求生命周期解耦，不新增 Redis。

### Selected Starter: create-next-app + pnpm workspace

**Initialization Commands**

```bash
pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

随后创建 `apps/worker`、`packages/domain`、`packages/db`、`packages/config`、`packages/testkit`。官方 `create-next-app --yes` 默认启用 TypeScript、Tailwind、ESLint、App Router 与 Turbopack；本项目显式参数以便 CI 可复现。

**Verified baseline (2026-07-13)**

- Node.js 24 LTS；生产只使用 LTS 分支（[官方发布策略](https://nodejs.org/en/about/previous-releases)）。
- Next.js App Router 与 `create-next-app@latest`（[官方安装文档](https://nextjs.org/docs/app/getting-started/installation)）。
- PostgreSQL 18 当前受支持，部署跟随其最新 minor（[官方版本策略](https://www.postgresql.org/support/versioning/)）。
- ORM 采用 Drizzle 的 PostgreSQL SQL-like API 与生成式迁移（[官方文档](https://orm.drizzle.team/docs/overview)）。

**Starter decisions**

- TypeScript strict、React Server Components、App Router
- Tailwind CSS + 项目 token，禁止在业务组件散落任意色值
- ESLint；后续加入格式化、Vitest、Playwright
- `@/*` 仅指向 Web 内部；跨包通过 workspace package 名导入
- 第一条实现 Story 负责初始化 workspace、最小 CI、健康检查和测试基线

## 3. Core Architectural Decisions

### Decision Priority Analysis

**Critical**

- PostgreSQL 为唯一强一致事实源；积分、冻结、票单和任务状态均落库。
- 追加式积分账本，不直接覆盖历史余额；物化账户余额在同一事务内更新并校验。
- 所有外部体育数据调用经 `SupplierGateway`；预算扣减与调用意图先原子入库。
- 后台 Worker 通过 PostgreSQL job table、租约和 `FOR UPDATE SKIP LOCKED` 抢占任务。
- REST JSON + session cookie；服务端进行身份、房间角色和超级管理员授权。

**Important**

- Server Components 默认，只有交互岛使用 Client Components。
- 查询缓存分两层：PostgreSQL 持久供应商快照 + HTTP `ETag/If-None-Match`；不在 Phase 1 引入 Redis。
- OpenAPI 3.1 从路由契约生成；Zod 在 API 边界验证输入输出。
- JSON structured logs、request/job correlation id、可查询审计事件。

**Deferred**

- WebSocket/SSE、公开排行榜、Logo/媒体素材、社交分享、支付及可提现能力均推迟，且现金能力明确禁止。

### Data Architecture

- 数据库：PostgreSQL 18，UTC，主键使用 UUIDv7/数据库生成 UUID；金额式积分使用 `numeric(20,2)`，禁止 IEEE float。
- Schema：`identity`、`competition`、`prediction`、`room`、`ledger`、`supplier`、`ops` 逻辑模块，共用一个数据库事务边界。
- ORM：Drizzle；迁移只通过已提交 SQL，生产禁止 schema push。
- 账户表保存 `available_points`、`frozen_points`、`correction_debt` 与 `version`；每次变更必须对应不可变 ledger entries，且满足余额守恒约束。
- Ticket 提交事务：锁定房间账户 → 检查 market open、data freshness、余额、单张 20,000 上限与幂等键 → 建 ticket/legs → available 转 frozen → 写 ledger → commit。
- Settlement 事务：按 `settlement_key(match_id, result_version)` 幂等；冻结释放、输赢入账与流水一次提交。
- Correction：原赛果结算以 reversal entries 完整冲正，再用新 `result_version` 重结；不足余额进入 `correction_debt`，后续入账先抵扣。
- Job table 字段：`type`, `payload`, `dedupe_key`, `run_at`, `status`, `attempts`, `lease_owner`, `lease_until`, `last_error`。

### Authentication & Security

- Phase 1 用户名 + 密码；密码使用 Argon2id 哈希，参数由安全测试固定并可迁移。
- 登录创建高熵 opaque session token；数据库只存 token hash。Cookie 为 `HttpOnly`, `Secure`, `SameSite=Lax`，所有状态变更检查 Origin/CSRF token。
- 恢复码只展示一次，服务端存哈希；使用后轮换并撤销全部旧 session。
- 角色：`user`、房间成员、`room_owner`、两个 seed 创建且唯一的 `super_admin`。管理员身份不由客户端声明。
- 房间授权：查询和命令都要求 membership；邀请 token 存哈希、过期时间、使用次数及撤销状态。
- 日志禁止密码、session、恢复码、邀请明文和完整 IP；审计保留 actor、action、target、result、timestamp、correlation id。
- 管理端无万能余额覆写接口；人工操作只能创建有原因码的追加式调整/冲正。

### API & Communication

- 路径：`/api/v1/...`，资源复数；JSON 使用 `camelCase`；时间为 ISO-8601 UTC；积分为字符串十进制或 `{amount, scale}`，禁止 JSON 浮点。
- 成功：单资源 `{data, meta?}`；列表 `{data: [], meta: {cursor?, total?}}`。
- 错误：`{error:{code,message,details?,correlationId}}`；稳定 code 供 UI 分支，message 可本地化。
- 幂等写入要求 `Idempotency-Key`；服务端以 `actor + route + key` 唯一并缓存最终响应摘要。
- 匹配/赔率读取返回 `dataAsOf`, `stale`, `supplierStatus`, `etag`。
- 客户端每 30–60 秒条件轮询；提交前必须重新获取 server state，服务端仍是最终裁决者。
- Supplier Gateway 接口：`syncFixtures`, `syncOdds`, `syncLiveStatus`, `fetchResult`；业务层不得直接引用供应商响应 DTO。

### Supplier Budget & Cache

- `supplier_daily_budget` 以 UTC 日期唯一，事务内原子增加 `general_used` 或 `settlement_used`。
- 日总上限 95；结算保护池 10 仅供赛果确认/结算，普通同步不可借用。
- 建议执行预算：fixtures 5、odds 70、live 10、settlement 10；未使用普通额度可留空，不自动侵占保护池。
- 调用前写 `supplier_request_intents`；网络结果回写状态和 response hash，以便不确定失败审计。
- 缓存：fixtures 6h/变化时刷新，赛前 odds 按距开球动态 5–30min，live 1–2min 但受预算限制，final result 永久版本化。
- 达阈值时停止非关键刷新，UI 显示过期时间；结算保护调用失败进入指数退避，绝不重复扣预算意图的同一 attempt。

### Frontend Architecture

- App Router route groups：public、authenticated、room、admin。
- Server Components 获取首屏数据；TanStack Query 仅用于需要轮询/乐观状态的客户端区域，不复制 server authority。
- 表单使用 Server/Route Action + Zod；预测 slip 存本地草稿，但提交结果以服务端响应为准。
- PWA service worker 只缓存 shell、静态资产和最后成功读取；离线时禁止排队预测提交，避免过封盘后重放。
- UX token 由 `styles/tokens.css` 管理；Source Serif/Noto Sans，纸张/墨色/球场绿/珊瑚强调色。
- 响应断点：mobile-first；核心提交、余额、封盘状态在 320px 宽仍可操作；WCAG 2.2 AA。

### Infrastructure & Deployment

- 两个容器/进程：`web` 与 `worker`，共享镜像基线与 workspace packages；一个 PostgreSQL 服务。
- 健康检查：`/api/health/live` 不访问外部依赖；`/api/health/ready` 检查数据库及迁移版本。
- CI：install frozen lockfile → lint → typecheck → unit → integration（PostgreSQL）→ build → Playwright smoke。
- 配置通过环境变量并由 Zod 启动时验证；`.env.example` 只含非敏感键名。
- 日志 stdout JSON；指标至少含 HTTP latency/error、job lag/failure、supplier budget、stale matches、settlement age、ledger invariant failure。
- 数据库每 6 小时自动备份、保留不少于 7 天，并做恢复演练；部署前 migration check，迁移与应用保持 expand/contract 兼容。

### Implementation Sequence

1. Workspace、CI、健康检查、配置验证
2. 数据库迁移框架、身份/session/RBAC
3. 房间、邀请、独立账户与初始化 10,000 分
4. Supplier Gateway、预算、缓存与比赛状态
5. 预测 slip、封盘、并发提交与冻结
6. Worker、自动结算、幂等重试
7. 赛果更正、冲正、审计和管理员运营
8. PWA、可访问性、性能与发布门禁

## 4. Implementation Patterns & Consistency Rules

### Naming

- DB：表名/列名 `snake_case` 复数表；外键 `<entity>_id`；索引 `idx_<table>__<columns>`；唯一约束 `uq_<table>__<columns>`。
- API：复数 kebab-case 路径，`:id` 文档表示，查询参数 camelCase。
- TypeScript：组件/类型 `PascalCase`，函数/变量 `camelCase`，常量 `UPPER_SNAKE_CASE`。
- 文件：React 组件 `kebab-case.tsx`，普通模块 `kebab-case.ts`，测试与源文件 co-located 为 `*.test.ts(x)`。
- 领域事件：过去式 `room.member_joined.v1`、`ticket.submitted.v1`、`match.settled.v1`。

### Structure

- 以 feature/domain 组织，禁止按 controller/service/repository 全局平铺。
- `apps/web` 不直接 import 数据库 schema；只调用 `packages/domain` application services。
- `packages/domain` 不依赖 Next.js、React 或供应商 SDK。
- `packages/db` 实现 repository 和 transaction port；业务 SQL 必须有对应 integration test。
- 外部供应商 DTO 只能存在于 `packages/integrations/api-football`。

### API and Data Formats

```json
{"data":{"ticketId":"...","status":"accepted"},"meta":{"serverTime":"2026-07-13T10:00:00Z"}}
```

```json
{"error":{"code":"MARKET_CLOSED","message":"该比赛已封盘","details":{"closedAt":"..."},"correlationId":"..."}}
```

- `null` 表示已知为空；字段未加载才省略。禁止混用空字符串。
- 所有枚举在 domain 包单一定义；数据库 constraint、OpenAPI 与 UI 从同一枚举映射。
- 用户可见时间本地化，API/DB 始终 UTC。

### Process Patterns

- Command handler 开始时验证身份/授权/输入，事务内重新验证竞争条件。
- 可重试仅限明确幂等的网络读、job 和带幂等键 command；随机 jitter 的指数退避有最大次数。
- UI 使用 skeleton、inline error、retry 三态；破坏性操作需确认；禁止用 toast 代替持久业务状态。
- 未捕获异常映射为 `INTERNAL_ERROR`，不向客户端暴露 stack/SQL；原始错误只进受控日志。
- 领域日志字段固定：`event`, `correlationId`, `actorId?`, `roomId?`, `matchId?`, `ticketId?`, `jobId?`, `outcome`。

### Transaction and Concurrency Rules

- 所有积分变更必须使用 `withLedgerTransaction()`，禁止任意 repository 更新余额。
- 账户行 `SELECT ... FOR UPDATE`；ticket idempotency unique key 阻止双击重复冻结。
- market 状态更新采用单向状态机和 compare-and-set version；`closed` 不因 kickoff 延迟自动回到 `open`。
- 结算/更正以数据库 unique constraints 做最终幂等，应用锁只是优化。
- 每个事务结束前断言 `available >= 0`、`frozen >= 0`、ledger delta 与 balance delta 一致；更正债务除外并单列。

### Enforcement

所有实现必须通过：TypeScript strict、ESLint boundary rules、迁移检查、OpenAPI contract test、ledger invariant property test、并发 integration test、Playwright 主旅程 smoke。发现架构例外时先更新 ADR，不得在 Story 内静默引入第二套模式。

**Anti-patterns**

- 客户端计算最终返还或判断封盘
- 直接调用 API-FOOTBALL
- 原地修改已结算 ledger entry
- 在 Route Handler 内编写大段 SQL/业务规则
- 依赖内存计数实现每日额度或幂等
- 离线排队预测写入

## 5. Project Structure & Boundaries

### Complete Directory Structure

```text
pulse/
├── apps/
│   ├── web/
│   │   ├── public/{icons,manifest.webmanifest}/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (public)/{login,register,recover}/
│   │   │   │   ├── (app)/{matches,rooms,account}/
│   │   │   │   ├── (room)/rooms/[roomId]/{page.tsx,leaderboard,predictions,members}/
│   │   │   │   ├── (admin)/admin/{dashboard,matches,settlements,supplier,audit}/
│   │   │   │   ├── api/v1/{auth,matches,rooms,tickets,admin}/
│   │   │   │   ├── api/health/{live,ready}/
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css
│   │   │   ├── features/{auth,matches,prediction-slip,rooms,leaderboard,admin}/
│   │   │   ├── components/{ui,layout,status}/
│   │   │   ├── lib/{api,auth,query,telemetry}/
│   │   │   ├── styles/tokens.css
│   │   │   └── middleware.ts
│   │   ├── tests/e2e/
│   │   └── next.config.ts
│   └── worker/
│       ├── src/{main.ts,runner.ts,handlers,schedules,telemetry}/
│       └── tests/integration/
├── packages/
│   ├── domain/src/
│   │   ├── identity/
│   │   ├── rooms/
│   │   ├── competition/
│   │   ├── predictions/
│   │   ├── ledger/
│   │   ├── settlement/
│   │   ├── supplier-budget/
│   │   ├── admin/
│   │   └── shared/{errors,events,types}/
│   ├── db/
│   │   ├── src/{client,schema,repositories,transactions,queries}/
│   │   ├── migrations/
│   │   └── tests/integration/
│   ├── integrations/
│   │   └── api-football/src/{client,adapter,dto,mappers,fixtures}/
│   ├── contracts/src/{schemas,openapi.ts,index.ts}/
│   ├── config/src/index.ts
│   └── testkit/src/{builders,database,fakes,clock}/
├── docs/{adr,runbooks,api}/
├── scripts/{check-migrations,seed-admins,verify-ledger}/
├── .github/workflows/ci.yml
├── compose.yaml
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── eslint.config.mjs
├── .env.example
└── README.md
```

### Architectural Boundaries

- **API boundary**：Route Handler 只负责 transport、session、schema parse、调用 application service 与 response mapping。
- **Domain boundary**：领域服务通过 ports 访问 repository、clock、id generator、supplier gateway；不感知 HTTP/React。
- **Data boundary**：仅 `packages/db` 可执行 SQL；事务由 application service 发起并传入 Unit of Work。
- **Supplier boundary**：Adapter 将供应商字段映射为内部 `FixtureSnapshot`, `OddsSnapshot`, `ResultSnapshot`。
- **Worker boundary**：Worker 与 Web 共用 application services；不得复制结算逻辑。

### Requirements to Structure Mapping

| PRD capability | Implementation home |
|---|---|
| FR1–FR12 身份、恢复、角色 | `domain/identity`, Web auth routes/features |
| FR13–FR23 比赛、赔率、过期 | `domain/competition`, integration adapter |
| FR24–FR32 预测与提交 | `domain/predictions`, `prediction-slip` |
| FR33–FR44 房间与邀请 | `domain/rooms`, room routes/features |
| FR45–FR54 积分、冻结、排名 | `domain/ledger`, leaderboard |
| FR55–FR64 封盘、结算、更正 | `domain/settlement`, worker handlers |
| FR65–FR69 配额与缓存 | `domain/supplier-budget`, adapter, worker schedules |
| FR70–FR72 管理与合规 | `domain/admin`, admin route group, audit |

### Integration and Data Flow

1. Worker 领取 sync job → Budget Guard 原子预留 → API-FOOTBALL Adapter → 快照/状态版本化入库。
2. Web 读取快照 → 返回 freshness/etag → 客户端条件轮询。
3. 用户提交 → API command → 事务锁与封盘复核 → ticket + freeze ledger → 响应。
4. Worker 获取 final result → 幂等 settlement → ledger/balance → UI 下次轮询可见。
5. 更正 result version → reversal → re-settle → audit event。

### Development Workflow

- 本地 `compose.yaml` 启 PostgreSQL；Web/Worker 可分别热重载。
- `pnpm test:integration` 使用隔离 schema/事务，不 mock 数据库并发语义。
- 构建生成 Web standalone 产物与 Worker Node bundle；同一 git SHA 部署。
- schema migration 先行，Web/Worker 都校验 migration compatibility 后 ready。

## 6. Architecture Validation Results

### Coherence Validation ✅

Next.js、Node.js Worker、Drizzle 与 PostgreSQL 组合兼容；不依赖 Redis/WebSocket 的选择与 Phase 1 规模、轮询 UX 和单开发者运维目标一致。HTTP、domain、data、supplier 边界无循环依赖。

### Requirements Coverage Validation ✅

FR1–FR72 均有明确模块归属；身份、邀请、房间积分、封盘、并发、供应商预算、自动结算、更正冲正与管理员审计拥有独立的持久化和事务策略。NFR1–NFR42 通过性能预算、WCAG、强一致事务、安全 session、备份、可观测性、缓存降级与 CI gate 获得架构支持。

### Implementation Readiness ✅

- 决策完整：技术基线、边界、状态/事务、API 格式与部署进程均已定义。
- 结构完整：首个 Story 可直接初始化目录，后续 Epic 可定位实现目录。
- 模式完整：高风险分歧点（时间、积分、幂等、外部配额、错误格式、离线提交）有唯一规则。

### Gap Analysis

- **Blocker：无。**
- **Important**：部署供应商尚未确定；实现保持容器和标准 PostgreSQL 可移植，不阻塞编码。
- **Important**：PRD 中少数 NFR 的精确测试环境在后续性能/发布 Story 固化。
- **Phase 2 gate**：公开数据、Logo/媒体素材上线前必须完成授权审查。

### Architecture Completeness Checklist

- [x] Project context and complexity assessed
- [x] Critical decisions and supported-version policy documented
- [x] Integration, security, persistence and deployment patterns defined
- [x] Complete directory structure and FR mapping supplied
- [x] Concurrency, ledger and settlement invariants supplied
- [x] Supplier budget and degraded-mode behavior supplied
- [x] AI-agent consistency rules and anti-patterns supplied

### Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**
**Confidence: High**

**First implementation priority**：初始化 pnpm workspace、Next.js Web、Worker package、基础 CI、配置验证、健康检查与最小测试；不要在基础 Story 中提前实现业务功能。

## 7. Implementation Handoff

实现 Agent 必须：

1. 先阅读 PRD、UX、本文档及当前 Story。
2. 遵循目录、边界、API 与事务模式；架构例外写 ADR。
3. 每个 Story 运行最小有意义的 lint/typecheck/test/build 验证。
4. 涉及 ledger、封盘、配额、结算时必须包含并发/幂等 integration test。
5. 不得把 Phase 2/3 能力偷渡进 Phase 1。
