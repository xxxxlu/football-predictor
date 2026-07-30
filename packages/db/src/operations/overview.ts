import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  type AuditQuery,
  type Capability,
  type OverviewCard,
  type OverviewSeverity,
  HIGH_RISK_AUDIT_ACTIONS,
  accountRiskSeverity,
  jobSeverity,
  overallSeverity,
  overviewNextStep,
  reportQueueSeverity,
  settlementSeverity,
  supplierSeverity,
  visibleOverviewCards,
  visibleReportKinds,
} from "@pulse/domain";
import { readOperatorAuthorization, type OperatorSql } from "../identity/operator-roles.js";
import { listGovernanceAudit } from "./moderation-privacy.js";
import { OperationError } from "./repository.js";

type DbTimestamp = Date | string;

/**
 * Unified operations overview and permission audit (FR60, FR81, FR90, NFR37–39).
 *
 * Two reads and one write live here:
 *
 *  - `overview` assembles the cards the actor's duties entitle them to. Each card
 *    is a separate scoped query that runs only when its capability is held, so
 *    aggregation can never show an operator a figure their own console would have
 *    refused them (AC2).
 *  - `listAudit` is the only gated entry point to the three-table merged trail,
 *    filterable by subject, target, action, result, time and correlation id (AC3).
 *    The merge itself lives beside its redaction helpers in moderation-privacy.ts,
 *    so there is one implementation no matter which surface asked.
 *  - `retryJob` is the FR58 safe retry: it clears a failed job's backoff wait so
 *    the worker can claim it again. It rewrites no payload, no attempt counter, no
 *    odds, no result and no settlement version, so FR59 is untouched.
 */
export class PostgresOperationsOverviewRepository {
  constructor(
    private readonly sql: postgres.Sql,
    /**
     * The existing health aggregate. Injected rather than reimplemented: supplier
     * budget, cache freshness and job counts have exactly one definition, and it
     * re-checks OPERATIONS_HEALTH_READ itself on every call.
     */
    private readonly health: { adminStatus(userId: string): Promise<AdminStatus> },
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async overview(actorUserId: string): Promise<OperationsOverview> {
    const authorization = await readOperatorAuthorization(this.sql, actorUserId);
    const cards = visibleOverviewCards(authorization.capabilities);
    // No card at all means no operational duty. This is the aggregate's own gate;
    // every section below still stands on its own capability.
    if (cards.length === 0) throw new OperationError("FORBIDDEN", 403);
    const visible = new Set<OverviewCard>(cards);
    const now = this.clock.now();

    // One health read serves the three health cards, but each card still stands on
    // its own entry in the registry: if their capabilities ever diverge, the card
    // that lost its capability stops rendering without this block being revisited.
    const needsHealth = visible.has("SUPPLIER_HEALTH") || visible.has("SETTLEMENT_HEALTH") || visible.has("JOB_HEALTH");
    const status = needsHealth ? await this.health.adminStatus(actorUserId) : null;
    const sections: OverviewSection[] = [];

    if (status && visible.has("SUPPLIER_HEALTH")) {
      const budget = status.supplierBudget;
      const generalRemaining = budget.limit - budget.settlementReserved - budget.generalUsed;
      sections.push({
        card: "SUPPLIER_HEALTH",
        severity: supplierSeverity({ generalRemaining, staleMatches: status.cache.staleMatches, unavailableMatches: status.cache.unavailableMatches }),
        metrics: [
          { key: "generalRemaining", label: "今日通用配额剩余", value: generalRemaining },
          { key: "settlementReserved", label: "结算预留", value: budget.settlementReserved },
          { key: "staleMatches", label: "数据过期比赛", value: status.cache.staleMatches },
          { key: "unavailableMatches", label: "数据不可用比赛", value: status.cache.unavailableMatches },
        ],
        detail: status.cache.oldestDataAsOf ? `最旧缓存时间 ${status.cache.oldestDataAsOf}` : null,
      });
    }

    if (status && visible.has("SETTLEMENT_HEALTH")) {
      const settlement = await this.settlementRisk();
      sections.push({
        card: "SETTLEMENT_HEALTH",
        severity: settlementSeverity({ failed: status.settlement.failed, pending: settlement.pending, overdueSettlements: settlement.overdue }),
        metrics: [
          { key: "pending", label: "待结算票据", value: settlement.pending },
          { key: "overdue", label: "赛事已结束仍未结算", value: settlement.overdue },
        ],
        detail: settlement.oldestPendingEventAt ? `最早未结算赛事 ${settlement.oldestPendingEventAt}` : null,
      });
    }

    if (status && visible.has("JOB_HEALTH")) {
      const jobs = status.jobs;
      sections.push({
        card: "JOB_HEALTH",
        severity: jobSeverity({ failed: jobs.failed, maxLagSeconds: jobs.maxLagSeconds }),
        metrics: [
          { key: "failed", label: "失败任务", value: jobs.failed },
          { key: "queued", label: "排队任务", value: jobs.queued },
          { key: "running", label: "执行中", value: jobs.running },
          { key: "maxLagSeconds", label: "最大排队延迟（秒）", value: jobs.maxLagSeconds },
        ],
        detail: null,
      });
    }

    if (visible.has("REPORT_QUEUE")) {
      // Narrowed to the report kinds this duty covers, exactly as the inbox is.
      const kinds = visibleReportKinds(authorization.capabilities);
      const queue = await this.reportQueue(actorUserId, kinds);
      sections.push({
        card: "REPORT_QUEUE",
        severity: reportQueueSeverity({ unassigned: queue.unassigned, pending: queue.pending }),
        metrics: [
          { key: "unassigned", label: "无人认领", value: queue.unassigned },
          { key: "mine", label: "我认领的", value: queue.mine },
          { key: "high", label: "高严重度待处理", value: queue.high },
          { key: "pending", label: "待处理合计", value: queue.pending },
        ],
        detail: queue.oldestPendingAt ? `最早待处理 ${queue.oldestPendingAt}` : null,
      });
    }

    if (visible.has("ACCOUNT_RISK")) {
      const accounts = await this.accountRisk(now);
      sections.push({
        card: "ACCOUNT_RISK",
        severity: accountRiskSeverity(accounts),
        metrics: [
          { key: "overdueAnonymizations", label: "超期匿名化请求", value: accounts.overdueAnonymizations },
          { key: "openAnonymizations", label: "待处理匿名化", value: accounts.openAnonymizations },
          { key: "disabledAccounts", label: "已禁用账户", value: accounts.disabledAccounts },
          { key: "restrictedRoomOwners", label: "名下有受限房间的账户", value: accounts.restrictedRoomOwners },
        ],
        detail: null,
      });
    }

    if (visible.has("ROLE_CHANGES")) {
      const roles = await this.roleChanges();
      sections.push({
        card: "ROLE_CHANGES",
        // Role movement is never an incident by itself — it is a thing to notice.
        severity: roles.recentChanges > 0 ? "WATCH" : "OK",
        metrics: [
          { key: "operationsAdmins", label: "运营管理员", value: roles.operationsAdmins },
          { key: "communityModerators", label: "社区协管员", value: roles.communityModerators },
          { key: "recentChanges", label: "近 7 天职责变更", value: roles.recentChanges },
        ],
        detail: roles.lastChangeAt ? `最近一次变更 ${roles.lastChangeAt}` : "尚无职责变更记录",
      });
    }

    if (visible.has("HIGH_RISK_ACTIONS")) {
      const risk = await this.highRiskActions();
      sections.push({
        card: "HIGH_RISK_ACTIONS",
        severity: risk.last24h > 0 ? "WATCH" : "OK",
        metrics: [
          { key: "last24h", label: "近 24 小时高风险操作", value: risk.last24h },
          { key: "last7d", label: "近 7 天高风险操作", value: risk.last7d },
        ],
        detail: risk.lastActionAt ? `最近一次 ${risk.lastAction} · ${risk.lastActionAt}` : "近期没有高风险操作",
      });
    }

    return {
      generatedAt: now.toISOString(),
      overall: overallSeverity(sections.map((section) => section.severity)),
      capabilities: authorization.capabilities,
      sections: sections.map((section) => ({ ...section, nextStep: overviewNextStep(section.card, authorization.capabilities) })),
    };
  }

  /**
   * The failed-task risk queue. Read-only and deliberately thin: kind, attempt
   * count, error code and timings. `last_error_detail` is sanitized on write but
   * still free text from a supplier, and payloads can name a fixture, so neither
   * leaves the database here.
   */
  async listFailedJobs(actorUserId: string, limit = 50): Promise<FailedJob[]> {
    await this.assertCapability(actorUserId, "OPERATIONS_HEALTH_READ");
    const rows = await this.sql<Array<{ id: string; kind: string; attempt: number; runCount: number; lastErrorCode: string | null; availableAt: DbTimestamp; updatedAt: DbTimestamp }>>`
      SELECT id, kind, attempt, run_count AS "runCount", last_error_code AS "lastErrorCode",
        available_at AS "availableAt", updated_at AS "updatedAt"
      FROM ops.jobs WHERE status = 'FAILED'
      ORDER BY updated_at DESC LIMIT ${limit}`;
    return rows.map((row) => ({
      id: row.id, kind: row.kind, attempt: row.attempt, runCount: row.runCount,
      lastErrorCode: row.lastErrorCode, availableAt: timestampIso(row.availableAt), updatedAt: timestampIso(row.updatedAt),
    }));
  }

  /**
   * FR58 safe retry. The honest description of what this does: it moves a FAILED
   * job back to QUEUED and sets `available_at` to now, which makes the job
   * claimable on the worker's next scheduled pass. It does not run anything
   * inline, and it deliberately leaves `payload`, `attempt`, `run_count` and
   * `result` exactly as the failure left them — the retry re-runs the same work
   * under the same idempotency key, so no odds, result or settlement version can
   * be rewritten by asking for one.
   */
  async retryJob(actorUserId: string, jobId: string, reason: string) {
    const auditId = randomUUID();
    const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(actorUserId, "OPERATIONS_TASK_RETRY", tx);
      const [job] = await tx<Array<{ id: string; kind: string; status: string; attempt: number; lastErrorCode: string | null }>>`
        SELECT id, kind, status, attempt, last_error_code AS "lastErrorCode"
        FROM ops.jobs WHERE id = ${jobId} FOR UPDATE`;
      if (!job) throw new OperationError("JOB_NOT_FOUND", 404);
      // Only a settled failure may be re-queued. A RUNNING job would be claimed
      // twice and a SUCCEEDED one has nothing to repeat.
      if (job.status !== "FAILED") throw new OperationError("JOB_NOT_RETRYABLE", 409);
      const [updated] = await tx<Array<{ id: string; status: string; availableAt: DbTimestamp }>>`
        UPDATE ops.jobs SET status = 'QUEUED', available_at = ${now}, updated_at = ${now}
        WHERE id = ${jobId} AND status = 'FAILED'
        RETURNING id, status, available_at AS "availableAt"`;
      if (!updated) throw new OperationError("JOB_NOT_RETRYABLE", 409);
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${actorUserId},'JOB_RETRY_REQUESTED','JOB',${jobId},'SUCCESS',
          ${JSON.stringify({ kind: job.kind, attempt: job.attempt, lastErrorCode: job.lastErrorCode, reason })}::text::jsonb,${now})`;
      return { jobId: updated.id, status: updated.status, availableAt: timestampIso(updated.availableAt), auditId };
    });
  }

  async listAudit(actorUserId: string, query: AuditQuery) {
    // The AUDIT_READ gate lives inside the merged read itself, so it cannot be
    // left behind by a caller that reaches the trail some other way.
    return listGovernanceAudit(this.sql, actorUserId, query);
  }

  private async settlementRisk() {
    // Football fixtures and F1 sessions both settle tickets, so both are joined:
    // counting only one sport would under-report the risk this card exists for.
    const [row] = await this.sql<Array<{ pending: number; overdue: number; oldestPendingEventAt: DbTimestamp | null }>>`
      SELECT COUNT(*)::int AS pending,
        COUNT(*) FILTER (WHERE f.status = 'FINISHED' OR s.state = 'FINISHED')::int AS overdue,
        MIN(COALESCE(f.kickoff_at, s.starts_at)) AS "oldestPendingEventAt"
      FROM prediction.tickets t
      LEFT JOIN supplier.fixtures f ON f.id = t.fixture_id
      LEFT JOIN f1.sessions s ON s.id::text = t.fixture_id
      WHERE t.status = 'PENDING'`;
    return {
      pending: row?.pending ?? 0,
      overdue: row?.overdue ?? 0,
      oldestPendingEventAt: row?.oldestPendingEventAt ? timestampIso(row.oldestPendingEventAt) : null,
    };
  }

  private async reportQueue(actorUserId: string, kinds: readonly string[]) {
    // A duty that opens the queue but covers no kind sees an empty queue rather
    // than an error: postgres.js cannot infer an element type for `ANY('{}')`.
    if (kinds.length === 0) return { pending: 0, unassigned: 0, mine: 0, high: 0, oldestPendingAt: null };
    const [row] = await this.sql<Array<{ pending: number; unassigned: number; mine: number; high: number; oldestPendingAt: DbTimestamp | null }>>`
      SELECT COUNT(*)::int AS pending,
        COUNT(*) FILTER (WHERE assigned_to IS NULL)::int AS unassigned,
        COUNT(*) FILTER (WHERE assigned_to = ${actorUserId})::int AS mine,
        COUNT(*) FILTER (WHERE severity = 'HIGH')::int AS high,
        MIN(created_at) AS "oldestPendingAt"
      FROM room.reports
      WHERE kind = ANY(${kinds as string[]}) AND status IN ('OPEN','ASSIGNED')`;
    return {
      pending: row?.pending ?? 0, unassigned: row?.unassigned ?? 0, mine: row?.mine ?? 0, high: row?.high ?? 0,
      oldestPendingAt: row?.oldestPendingAt ? timestampIso(row.oldestPendingAt) : null,
    };
  }

  private async accountRisk(now: Date) {
    const dueBefore = new Date(now.getTime() - ANONYMIZATION_SLA_MS).toISOString();
    const [row] = await this.sql<Array<{ disabledAccounts: number; openAnonymizations: number; overdueAnonymizations: number; restrictedRoomOwners: number }>>`
      SELECT
        (SELECT COUNT(*) FROM identity.users WHERE status = 'DISABLED' AND is_super_admin = false)::int AS "disabledAccounts",
        (SELECT COUNT(*) FROM ops.privacy_requests WHERE status = 'RECEIVED')::int AS "openAnonymizations",
        (SELECT COUNT(*) FROM ops.privacy_requests WHERE status = 'RECEIVED' AND requested_at < ${dueBefore}::timestamptz)::int AS "overdueAnonymizations",
        (SELECT COUNT(DISTINCT created_by) FROM room.rooms WHERE status = 'RESTRICTED')::int AS "restrictedRoomOwners"`;
    return {
      disabledAccounts: row?.disabledAccounts ?? 0,
      openAnonymizations: row?.openAnonymizations ?? 0,
      overdueAnonymizations: row?.overdueAnonymizations ?? 0,
      restrictedRoomOwners: row?.restrictedRoomOwners ?? 0,
    };
  }

  private async roleChanges() {
    const since = new Date(this.clock.now().getTime() - 7 * DAY_MS).toISOString();
    const [row] = await this.sql<Array<{ operationsAdmins: number; communityModerators: number; recentChanges: number; lastChangeAt: DbTimestamp | null }>>`
      SELECT
        (SELECT COUNT(*) FROM identity.operator_role_grants WHERE role = 'OPERATIONS_ADMIN' AND revoked_at IS NULL)::int AS "operationsAdmins",
        (SELECT COUNT(*) FROM identity.operator_role_grants WHERE role = 'COMMUNITY_MODERATOR' AND revoked_at IS NULL)::int AS "communityModerators",
        (SELECT COUNT(*) FROM identity.admin_account_audit_events
          WHERE action IN ('OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED') AND occurred_at >= ${since}::timestamptz)::int AS "recentChanges",
        (SELECT MAX(occurred_at) FROM identity.admin_account_audit_events
          WHERE action IN ('OPERATOR_ROLE_GRANTED','OPERATOR_ROLE_REVOKED')) AS "lastChangeAt"`;
    return {
      operationsAdmins: row?.operationsAdmins ?? 0,
      communityModerators: row?.communityModerators ?? 0,
      recentChanges: row?.recentChanges ?? 0,
      lastChangeAt: row?.lastChangeAt ? timestampIso(row.lastChangeAt) : null,
    };
  }

  private async highRiskActions() {
    const now = this.clock.now();
    const day = new Date(now.getTime() - DAY_MS).toISOString();
    const week = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    // The high-risk set spans two of the three audit tables, so the window counts
    // are taken over the same union the trail itself reads.
    const [row] = await this.sql<Array<{ last24h: number; last7d: number; lastAction: string | null; lastActionAt: DbTimestamp | null }>>`
      WITH risky AS (
        SELECT a.action, a.occurred_at FROM ops.audit_events a
          WHERE a.action = ANY(${HIGH_RISK_ACTIONS}) AND a.occurred_at >= ${week}::timestamptz
        UNION ALL
        SELECT e.action, e.occurred_at FROM identity.admin_account_audit_events e
          WHERE e.action = ANY(${HIGH_RISK_ACTIONS}) AND e.occurred_at >= ${week}::timestamptz
      )
      SELECT COUNT(*) FILTER (WHERE occurred_at >= ${day}::timestamptz)::int AS "last24h",
        COUNT(*)::int AS "last7d",
        (SELECT action FROM risky ORDER BY occurred_at DESC LIMIT 1) AS "lastAction",
        (SELECT MAX(occurred_at) FROM risky) AS "lastActionAt"
      FROM risky`;
    return {
      last24h: row?.last24h ?? 0, last7d: row?.last7d ?? 0,
      lastAction: row?.lastAction ?? null,
      lastActionAt: row?.lastActionAt ? timestampIso(row.lastActionAt) : null,
    };
  }

  private async assertCapability(userId: string, capability: Capability, tx?: OperatorSql) {
    const authorization = await readOperatorAuthorization(tx ?? this.sql, userId);
    if (!authorization.capabilities.includes(capability)) throw new OperationError("FORBIDDEN", 403);
    return authorization;
  }
}

const DAY_MS = 86_400_000;
/** NFR22: public-identity removal is due within seven days of the request. */
const ANONYMIZATION_SLA_MS = 7 * DAY_MS;

/**
 * The domain's list, copied into a mutable array because that is what the
 * postgres.js parameter encoder accepts for `= ANY(...)`. Spread from the single
 * source rather than retyped, so the two can never name different actions.
 */
const HIGH_RISK_ACTIONS: string[] = [...HIGH_RISK_AUDIT_ACTIONS];

function timestampIso(value: DbTimestamp) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export interface OverviewMetric { key: string; label: string; value: number }
export interface OverviewSection {
  card: OverviewCard;
  severity: OverviewSeverity;
  metrics: OverviewMetric[];
  detail: string | null;
}
export interface OperationsOverview {
  generatedAt: string;
  overall: OverviewSeverity;
  capabilities: Capability[];
  sections: Array<OverviewSection & { nextStep: { label: string; href: string; capability: Capability } | null }>;
}
export interface FailedJob {
  id: string; kind: string; attempt: number; runCount: number;
  lastErrorCode: string | null; availableAt: string; updatedAt: string;
}

/** The shape `overview` consumes from the existing health aggregate. */
export interface AdminStatus {
  supplierBudget: { limit: number; generalUsed: number; settlementUsed: number; settlementReserved: number };
  cache: { staleMatches: number; unavailableMatches: number; oldestDataAsOf: string | null };
  settlement: { pending: number; failed: number };
  jobs: { queued: number; running: number; failed: number; maxLagSeconds: number };
}
