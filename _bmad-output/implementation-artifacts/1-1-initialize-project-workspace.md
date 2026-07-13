# Story 1.1: 从 Starter Template 初始化项目工作区

Status: done

## Story

As a 开发团队,
I want 获得可重复构建的 Web、Worker 与共享包工作区,
so that 后续用户能力能在一致边界和 CI 保护下增量交付。

## Acceptance Criteria

1. **Given** 仓库当前仅包含规划/BMAD 工件，**When** 按 Architecture 的 starter 决策初始化，**Then** 根目录形成 pnpm workspace，至少包含 `apps/web`、`apps/worker`、`packages/domain`、`packages/db`、`packages/config`、`packages/contracts`、`packages/testkit`，**And** Next.js Web 使用 TypeScript strict、App Router、Tailwind、ESLint、`src/` 和 `@/*` alias。
2. **Given** 新鲜 checkout 使用 Node.js 24 LTS 与 pnpm，**When** 执行 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，**Then** 全部成功且不要求真实 API-FOOTBALL key，**And** lockfile、workspace scripts 与 CI 执行同一命令。
3. **Given** Web 或 Worker 缺少必需配置，**When** 进程启动，**Then** 通过共享 Zod config 以明确、无 secret 的错误 fail fast，**And** `.env.example` 只列键名与非敏感示例。
4. **Given** Web 进程已运行，**When** 请求 `/api/health/live`，**Then** 返回进程存活、版本和 correlation id 且不调用数据库或供应商，**And** 请求 `/api/health/ready` 时能根据当前基础依赖状态返回 200/503，不调用 API-FOOTBALL。
5. **Given** Worker 包被构建或启动，**When** 运行其 smoke test，**Then** 入口、结构化日志和优雅关闭钩子可用，**And** 本 Story 不创建业务 job、比赛、用户或账本表。
6. **Given** Pull Request 或本地验证，**When** CI 工作流运行，**Then** 使用 frozen lockfile 顺序执行 lint、typecheck、unit test、build，**And** 任一步失败都会阻止成功状态。

## Tasks / Subtasks

- [x] Task 1: 初始化 monorepo 与 Next.js starter（AC: 1, 2）
  - [x] 创建 root `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.npmrc` 与 root scripts。
  - [x] 使用 `pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm` 的等价输出初始化 Web；清理演示内容但保留 starter 约定。
  - [x] 固定 `engines.node` 为受支持的 Node 24 LTS 范围；提交 `pnpm-lock.yaml`。
- [x] Task 2: 创建 Worker 与共享 package 骨架（AC: 1, 5）
  - [x] 创建 `apps/worker` 入口、构建/测试配置、structured logger 和 SIGTERM/SIGINT shutdown。
  - [x] 创建 domain/db/contracts/config/testkit package；只导出最小边界，不提前建业务模型。
  - [x] workspace 包通过 package 名导入，禁止跨目录相对深链。
- [x] Task 3: 实现类型安全配置（AC: 2, 3）
  - [x] 在 `packages/config` 用 Zod 建立 server runtime config schema；区分 required/optional/test defaults。
  - [x] 添加 `.env.example`；测试错误不包含 secret value。
- [x] Task 4: 实现 Web 健康检查与 request correlation（AC: 4）
  - [x] 创建 `apps/web/src/app/api/health/live/route.ts`。
  - [x] 创建 `apps/web/src/app/api/health/ready/route.ts`；本 Story 只检查已引入的基础依赖，不伪造供应商健康。
  - [x] 为响应建立稳定 JSON shape 与测试。
- [x] Task 5: 建立测试和 CI 基线（AC: 2, 5, 6）
  - [x] 配置 Vitest；每个可执行 app 至少有一个有效 smoke/unit test，禁止只写 `pass` 占位。
  - [x] 创建 `.github/workflows/ci.yml` 并缓存 pnpm store，执行与本地相同的 root scripts。
  - [x] 验证 `lint`, `typecheck`, `test`, `build` 全部通过。
- [x] Task 6: 写开发说明（AC: 2–5）
  - [x] README 记录 Node/pnpm 前置、安装、开发、Web/Worker 启动、测试、health endpoints 与环境变量。
  - [x] 记录本地 Node 25.5.0 不是生产 LTS 基线；CI/生产使用 Node 24。

## Dev Notes

### Critical Scope Guardrails

- 这是 greenfield enabling Story，只建立可运行骨架；**不得**实现注册、房间、API-FOOTBALL、预测、积分或结算。
- 不创建“未来会用到”的全量数据库 schema。`packages/db` 可有 package/client boundary placeholder，但业务表随相应 Story 首次需要时创建。
- Phase 1 不引入 Redis、WebSocket、消息中间件、第二套后台或付费服务。
- 不手写一个与 `create-next-app` 不一致的自定义 React build；以官方 starter 为基线。
- 本 Story 不需要 API-FOOTBALL key，测试与 build 不能联网调用供应商。

### Architecture Compliance

- Runtime：生产 Node.js 24 LTS；本机当前 Node 25.5.0 仅可作临时开发运行，不能写入 production baseline。
- Web：Next.js App Router、TypeScript strict、Tailwind、ESLint、Server Components 默认。
- Worker：独立 Node.js process，与 Web 共享 packages，不能 import `apps/web`。
- 边界：`apps/web`/`apps/worker` 可依赖 packages；`packages/domain` 不依赖 React/Next；`packages/db` 是未来唯一 SQL 边界。
- API：JSON camelCase、UTC ISO 时间、error/correlationId 结构；health route 位于 `/api/health/*`，不放入版本化业务 API。
- PWA、数据库连接、Drizzle migration、PostgreSQL job table 均不是本 Story 完成条件，除非 starter/build 所需；不得为追求“完整”扩大范围。

### Library / Framework Requirements

- 使用 `create-next-app@latest` 生成当前官方 App Router baseline；实际版本由 `pnpm-lock.yaml` 固定。
- Node.js 24 是 2026-07-13 官方 LTS；生产应用只使用 Active/Maintenance LTS。
- Vitest 用于 unit/smoke；不要同时引入 Jest。
- 配置验证使用 Zod；同一 config package 供 Web/Worker 复用。
- 除 starter 和上述明确库外，不新增 ORM、queue、auth、state-management 或 UI component framework。

### File Structure Requirements

```text
apps/web/
  src/app/api/health/live/route.ts
  src/app/api/health/ready/route.ts
apps/worker/src/main.ts
packages/config/src/index.ts
packages/{domain,db,contracts,testkit}/src/index.ts
.github/workflows/ci.yml
package.json
pnpm-workspace.yaml
tsconfig.base.json
.env.example
README.md
```

可增加构建/测试配置文件，但不得改变 Architecture 的 `apps/` + `packages/` 边界。

### Testing Requirements

- Root verification: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
- Config tests：合法配置、缺失 required key、错误消息不泄露 secret。
- Health route tests：live 200；ready 的 ready/unready 分支；任何分支不触发供应商调用。
- Worker smoke：入口可启动/停止，SIGTERM 路径可测试，日志为 JSON 或结构化对象。
- CI 必须使用 Node 24 和 `pnpm install --frozen-lockfile`。

### Latest Technical Information

- Next.js 官方安装文档（2026-03-16 更新）说明 `create-next-app --yes` 默认包含 TypeScript、Tailwind、ESLint、App Router、Turbopack，并要求 Node.js ≥20.9；本项目显式参数确保可复现。
- Node.js 官方发布表在 2026-07-13 将 v24 标为 LTS、v25 标为 EOL、v26 标为 Current；因此生产/CI 固定 v24。

### Project Structure Notes

- 当前代码基线为空，不存在需要兼容的应用源码；最近 Git commits 仅包含 product brief/journey 文档。
- `_bmad-output/` 是规划与实现工件目录，不得把应用代码生成到其中。
- `.claude/`, `_bmad/` 与现有 planning artifacts 不属于 starter 清理范围。

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Story 1.1]
- [Source: `_bmad-output/planning-artifacts/architecture.md` — Starter Template Evaluation, Core Architectural Decisions, Project Structure]
- [Source: `_bmad-output/planning-artifacts/prd.md` — Project Scoping & Phased Development, NFR21, NFR42]
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` — responsive/accessibility context; no feature UI required in this Story]
- [Official Next.js Installation](https://nextjs.org/docs/app/getting-started/installation)
- [Official Node.js Releases](https://nodejs.org/en/about/previous-releases)

## Dev Agent Record

### Agent Model Used

GPT-5.5 Codex

### Debug Log References

- RED: `node --test scripts/workspace-structure.test.mjs` initially failed because `apps/web/package.json` did not exist.
- RED: focused Vitest run initially failed for missing config, health routes and Worker runtime modules.
- First production build exposed external Google Font fetching; removed network-dependent `next/font` use.
- Sandboxed Turbopack build could not bind its temporary local port; the same build passed with approved build-process permissions.

### Completion Notes List

- Initialized an 8-project pnpm workspace from the official Next.js App Router starter and fixed actual dependency versions in `pnpm-lock.yaml`.
- Added framework-free package boundaries, a separate Worker with structured lifecycle logging and idempotent shutdown, and no premature business schema.
- Added Zod runtime configuration with redacted failures plus live/ready health endpoints and correlation IDs.
- Added 6 focused Vitest tests plus a Node workspace structure test; all pass.
- Added Node 24 CI with frozen install, lint, typecheck, test and build gates.
- Final verification: frozen install PASS; lint PASS; typecheck PASS; 4 test files / 6 Vitest tests PASS; workspace test PASS; YAML syntax PASS; production build PASS.
- Local Node 25.5.0 correctly emits an engine warning because production/CI are intentionally pinned to Node 24 LTS.

### File List

- `.env.example`
- `.github/workflows/ci.yml`
- `.npmrc`
- `README.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `vitest.config.ts`
- `scripts/workspace-structure.test.mjs`
- `apps/web/.gitignore`
- `apps/web/README.md`
- `apps/web/eslint.config.mjs`
- `apps/web/next-env.d.ts`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/postcss.config.mjs`
- `apps/web/tsconfig.json`
- `apps/web/public/file.svg`
- `apps/web/public/globe.svg`
- `apps/web/public/next.svg`
- `apps/web/public/vercel.svg`
- `apps/web/public/window.svg`
- `apps/web/src/app/favicon.ico`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/api/health/live/route.ts`
- `apps/web/src/app/api/health/live/route.test.ts`
- `apps/web/src/app/api/health/ready/route.ts`
- `apps/web/src/app/api/health/ready/route.test.ts`
- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/src/main.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/runtime.test.ts`
- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `packages/contracts/package.json`
- `packages/contracts/tsconfig.json`
- `packages/contracts/src/index.ts`
- `packages/db/package.json`
- `packages/db/tsconfig.json`
- `packages/db/src/index.ts`
- `packages/domain/package.json`
- `packages/domain/tsconfig.json`
- `packages/domain/src/index.ts`
- `packages/testkit/package.json`
- `packages/testkit/tsconfig.json`
- `packages/testkit/src/index.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-1-initialize-project-workspace.md`

### Change Log

- 2026-07-13: User explicitly waived code review for rapid launch; Story marked done after previously passing all DoD checks.
- 2026-07-13: Initialized monorepo foundation, health/config/Worker baselines, automated tests, CI and documentation; moved Story 1.1 to review.
