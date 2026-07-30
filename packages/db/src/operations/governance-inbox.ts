import { randomUUID } from "node:crypto";
import {
  assertMinimalReportContext,
  availableDispositions,
  canTransitionReport,
  dispositionCapability,
  DISPOSITION_NOTICE_KIND,
  isMuteActive,
  isTerminalReportStatus,
  muteExpiresAt,
  noticeAudience,
  resolveInboxKinds,
  resolveInboxStatuses,
  roomStatusForDisposition,
  visibleReportKinds,
  type GovernanceInboxQuery,
  type GovernanceNoticeKind,
  type MuteDurationHours,
  type NoticeAudienceRole,
  type ReportDetail,
  type ReportDisposition,
  type ReportHistoryEntry,
  type ReportKind,
  type ReportSeverity,
  type ReportStatus,
  type ReportSummary,
} from "@pulse/domain";
import type postgres from "postgres";
import { readOperatorAuthorization, type OperatorAuthorization, type OperatorSql } from "../identity/operator-roles.js";
import { normalizeAuditEvent, type GovernanceAuditRow, type ModeratedRoomStatus } from "./moderation-privacy.js";
import { OperationError } from "./repository.js";

type DbTimestamp = Date | string;

type ReportRow = {
  reportId: string; kind: ReportKind; severity: ReportSeverity; status: ReportStatus; reason: string;
  reporterUserId: string; reporter: string; assignedTo: string | null; assignee: string | null;
  subject: string; createdAt: DbTimestamp; updatedAt: DbTimestamp;
};

type ReportTargetRow = {
  reportId: string; kind: ReportKind; status: ReportStatus; reporterUserId: string; assignedTo: string | null;
  roomId: string; roomName: string; roomStatus: ModeratedRoomStatus; roomOwnerId: string;
  messageId: string | null; subjectUserId: string | null;
};

/**
 * Room and community governance inbox (FR81, FR83, FR90).
 *
 * Two rules hold for every method here:
 *
 * 1. The caller's live capabilities decide which report *kinds* they may touch,
 *    re-read from storage on each call — on top of the check the route already
 *    made. A report of a kind outside the caller's duty is reported as not found,
 *    because from where they stand it does not exist.
 *
 * 2. Every disposition names a report, never a room, a message or a member. The
 *    target is derived from the report row inside the same transaction, so there
 *    is no parameter through which an operator could reach a room or a
 *    conversation nobody reported.
 *
 * Nothing here touches a balance, a prediction or a ledger row (FR59). Hiding a
 * message and muting a member are reversible participation states; the message
 * itself is never deleted.
 */
export class PostgresGovernanceInboxRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  /** The queue, narrowed to the kinds the caller may read and to their filters. */
  async listReports(actorUserId: string, query: GovernanceInboxQuery): Promise<ReportSummary[]> {
    const authorization = await this.authorization(actorUserId);
    const kinds = resolveInboxKinds(query.kind, authorization.capabilities);
    const statuses = resolveInboxStatuses(query.status);
    // Built as a fragment rather than an inline parameter: an empty array has no
    // inferable element type on the wire, and "no status filter" is a common case.
    const statusPredicate = statuses.length === 0 ? this.sql`true` : this.sql`rp.status = ANY(${statuses})`;
    const rows = await this.sql<ReportRow[]>`
      ${this.reportSelect()}
      WHERE rp.kind = ANY(${kinds})
        AND ${statusPredicate}
        AND (${query.severity} = 'ALL' OR rp.severity = ${query.severity})
        AND (${query.assignee} = 'ALL'
          OR (${query.assignee} = 'ME' AND rp.assigned_to = ${actorUserId})
          OR (${query.assignee} = 'UNASSIGNED' AND rp.assigned_to IS NULL)
          OR (${query.assignee} = 'OTHERS' AND rp.assigned_to IS NOT NULL AND rp.assigned_to <> ${actorUserId}))
      ORDER BY CASE WHEN rp.status IN ('OPEN','ASSIGNED') THEN 0 ELSE 1 END,
        CASE rp.severity WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
        rp.created_at DESC
      LIMIT ${query.limit}`;
    return rows.map((row) => this.toSummary(row, actorUserId));
  }

  /**
   * One report with the minimum context needed to decide it, plus its own
   * history. The history is scoped to this report, which is why the inbox duty is
   * enough — the platform-wide trail stays behind AUDIT_READ.
   */
  async getReport(actorUserId: string, reportId: string): Promise<ReportDetail> {
    const authorization = await this.authorization(actorUserId);
    const visible = visibleReportKinds(authorization.capabilities);
    if (visible.length === 0) throw new OperationError("FORBIDDEN", 403);
    const [row] = await this.sql<ReportRow[]>`${this.reportSelect()} WHERE rp.id = ${reportId} LIMIT 1`;
    // Not "forbidden": confirming that a report exists is itself a disclosure to
    // an operator who has no duty over that surface.
    if (!row || !visible.includes(row.kind)) throw new OperationError("REPORT_NOT_FOUND", 404);

    const detail: ReportDetail = {
      ...this.toSummary(row, actorUserId),
      room: row.kind === "ROOM" ? await this.roomContext(reportId) : null,
      message: row.kind === "MESSAGE" ? await this.messageContext(reportId) : null,
      history: await this.history(reportId),
      availableDispositions: availableDispositions(row.kind, authorization.capabilities),
    };
    // Defence in depth: a future widening of either projection fails here rather
    // than shipping unrelated private content to a moderator.
    assertMinimalReportContext(detail);
    return detail;
  }

  /**
   * Triage: claim, release, or re-prioritise. Nothing a member can see changes,
   * so this carries no reason and needs no re-authentication — only the duty for
   * that kind. It is still audited.
   */
  async triageReport(actorUserId: string, reportId: string, input: { assign?: "ME" | "NONE"; severity?: ReportSeverity }) {
    const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      const target = await this.lockReport(tx, actorUserId, reportId, (kind, authorization) => {
        if (!availableDispositions(kind, authorization.capabilities).length) throw new OperationError("FORBIDDEN", 403);
      });
      if (isTerminalReportStatus(target.status)) throw new OperationError("REPORT_ALREADY_CLOSED", 409);
      const assignedTo = input.assign === "ME" ? actorUserId : input.assign === "NONE" ? null : undefined;
      const nextStatus: ReportStatus = assignedTo === undefined ? target.status : assignedTo ? "ASSIGNED" : "OPEN";
      if (!canTransitionReport(target.status, nextStatus)) throw new OperationError("REPORT_TRANSITION_INVALID", 409);
      const [updated] = await tx<Array<{ reportId: string; status: ReportStatus; severity: ReportSeverity }>>`
        UPDATE room.reports SET
          status = ${nextStatus},
          severity = COALESCE(${input.severity ?? null}, severity),
          assigned_to = ${assignedTo === undefined ? tx`assigned_to` : assignedTo},
          assigned_at = ${assignedTo === undefined ? tx`assigned_at` : assignedTo ? now : null},
          updated_at = ${now}
        WHERE id = ${reportId}
        RETURNING id AS "reportId", status, severity`;
      // Claiming a report someone else holds, or releasing their claim, is allowed
      // — but it must not be silent. Recording who held it keeps the chain of
      // responsibility readable after a takeover.
      const takenFrom = assignedTo !== undefined && target.assignedTo && target.assignedTo !== actorUserId ? { takenFrom: target.assignedTo } : {};
      await this.audit(tx, { auditId, actorUserId, action: "REPORT_TRIAGED", targetId: reportId, occurredAt: now, metadata: { reportId, assigned: assignedTo === undefined ? "unchanged" : assignedTo ? "self" : "none", severity: updated!.severity, ...takenFrom } });
      return { ...updated!, auditId };
    });
  }

  /**
   * Applies a disposition and closes the report: capability for that kind, a
   * written reason, the state change, a notice to everyone affected and an
   * immutable audit entry — all in one transaction, so an action can never land
   * without its explanation (AC4).
   */
  async resolveReport(actorUserId: string, reportId: string, input: { disposition: ReportDisposition; reason: string; muteHours?: MuteDurationHours }) {
    const auditId = randomUUID(); const nowDate = this.clock.now(); const now = nowDate.toISOString();
    return this.sql.begin(async (tx) => {
      const target = await this.lockReport(tx, actorUserId, reportId, (kind, authorization) => {
        const required = dispositionCapability(kind, input.disposition);
        if (!authorization.capabilities.includes(required)) throw new OperationError("FORBIDDEN", 403);
      });
      if (isTerminalReportStatus(target.status)) throw new OperationError("REPORT_ALREADY_CLOSED", 409);

      const status: ReportStatus = input.disposition === "DISMISS" ? "DISMISSED" : "RESOLVED";
      const affected = new Map<string, NoticeAudienceRole>();
      const note = (userId: string | null, role: NoticeAudienceRole) => {
        if (userId && !affected.has(userId)) affected.set(userId, role);
      };
      const audience = noticeAudience(input.disposition);
      let details: Record<string, unknown> = {};

      switch (input.disposition) {
        case "RESTRICT_ROOM":
        case "CLOSE_ROOM":
        case "RESTORE_ROOM": {
          const roomStatus = roomStatusForDisposition(input.disposition);
          // A disposition that leaves the room where it already is settles every
          // open filing against it while changing nothing — "restore" on a room
          // that was never restricted would empty the queue as a favour. Closing a
          // report needs a decision that actually acts on what was reported.
          if (roomStatus === target.roomStatus) throw new OperationError("ROOM_ALREADY_IN_STATE", 409);
          await tx`UPDATE room.rooms SET status = ${roomStatus}, updated_at = ${now} WHERE id = ${target.roomId}`;
          // One decision settles every open filing against that room, and each of
          // those reporters is told the outcome.
          const siblings = await tx<Array<{ reportId: string; reporterUserId: string }>>`
            UPDATE room.reports SET status = ${status}, resolved_by = ${actorUserId}, resolution = ${input.disposition},
              resolution_note = ${input.reason}, resolved_at = ${now}, updated_at = ${now}
            WHERE room_id = ${target.roomId} AND kind = 'ROOM' AND status IN ('OPEN','ASSIGNED')
            RETURNING id AS "reportId", reporter_user_id AS "reporterUserId"`;
          if (audience.includes("ROOM_OWNER")) note(target.roomOwnerId, "ROOM_OWNER");
          if (audience.includes("REPORTER")) for (const sibling of siblings) note(sibling.reporterUserId, "REPORTER");
          // Each filing closed along the way gets its own entry. The decision is
          // audited once under the report it was taken on; without a row of their
          // own, the other reports would read as "resolved" with nothing in their
          // timeline explaining by what.
          for (const sibling of siblings) {
            if (sibling.reportId === reportId) continue;
            await this.audit(tx, {
              auditId: randomUUID(), actorUserId, action: `REPORT_${status}`, targetId: sibling.reportId, occurredAt: now,
              metadata: { reportId: sibling.reportId, disposition: input.disposition, reason: input.reason, resolutionAuditId: auditId },
            });
          }
          // The room's own status change is audited under the room, in the same
          // vocabulary the room list writes (`ROOM_CLOSE` and friends). Without it
          // a closure reached through a report would be invisible to a search by
          // room and would not count as the high-risk action it is — the report
          // entry below records the decision, this one records what it did.
          const roomAuditId = randomUUID();
          await this.audit(tx, {
            auditId: roomAuditId, actorUserId, targetType: "ROOM",
            action: `ROOM_${input.disposition.replace("_ROOM", "")}`,
            targetId: target.roomId, occurredAt: now,
            metadata: { reportId, roomStatus, reason: input.reason, resolutionAuditId: auditId },
          });
          details = { roomStatus, resolvedReports: siblings.length, roomAuditId };
          break;
        }
        case "HIDE_MESSAGE": {
          await tx`INSERT INTO room.message_moderation (message_id,room_id,state,report_id,reason,hidden_by,hidden_at)
            VALUES (${target.messageId},${target.roomId},'HIDDEN',${reportId},${input.reason},${actorUserId},${now})
            ON CONFLICT (message_id) DO UPDATE SET state='HIDDEN',report_id=${reportId},reason=${input.reason},
              hidden_by=${actorUserId},hidden_at=${now},restored_by=NULL,restored_at=NULL`;
          details = { messageHidden: true };
          break;
        }
        case "RESTORE_MESSAGE": {
          const restored = await tx<Array<{ messageId: string }>>`
            UPDATE room.message_moderation SET state='RESTORED',restored_by=${actorUserId},restored_at=${now}
            WHERE message_id = ${target.messageId} AND state = 'HIDDEN' RETURNING message_id AS "messageId"`;
          if (!restored[0]) throw new OperationError("MESSAGE_NOT_HIDDEN", 409);
          details = { messageHidden: false };
          break;
        }
        case "MUTE_MEMBER": {
          if (!input.muteHours) throw new OperationError("MUTE_DURATION_REQUIRED", 422);
          // Close out a window that has already run out, so the "one live mute"
          // index cannot block a legitimate mute months later.
          await tx`UPDATE room.member_mutes SET lifted_at = muted_until
            WHERE room_id = ${target.roomId} AND user_id = ${target.subjectUserId} AND lifted_at IS NULL AND muted_until <= ${now}`;
          const mutedUntil = muteExpiresAt(nowDate, input.muteHours).toISOString();
          try {
            await tx`INSERT INTO room.member_mutes (id,room_id,user_id,report_id,reason,muted_by,muted_at,muted_until)
              VALUES (${randomUUID()},${target.roomId},${target.subjectUserId},${reportId},${input.reason},${actorUserId},${now},${mutedUntil})`;
          } catch (error) {
            if (isUniqueViolation(error)) throw new OperationError("MUTE_ALREADY_ACTIVE", 409);
            throw error;
          }
          details = { mutedUntil, muteHours: input.muteHours };
          break;
        }
        case "DISMISS":
          break;
      }

      if (input.disposition !== "RESTRICT_ROOM" && input.disposition !== "CLOSE_ROOM" && input.disposition !== "RESTORE_ROOM") {
        await tx`UPDATE room.reports SET status = ${status}, resolved_by = ${actorUserId}, resolution = ${input.disposition},
          resolution_note = ${input.reason}, resolved_at = ${now}, updated_at = ${now} WHERE id = ${reportId}`;
        if (audience.includes("SUBJECT")) note(target.subjectUserId, "SUBJECT");
        if (audience.includes("REPORTER")) note(target.reporterUserId, "REPORTER");
      }

      await this.audit(tx, { auditId, actorUserId, action: `REPORT_${status}`, targetId: reportId, occurredAt: now, metadata: { reportId, kind: target.kind, disposition: input.disposition, reason: input.reason, ...details } });
      // The count of notices written, not of accounts considered: the operator is
      // skipped when they are also the owner or a reporter, and the console shows
      // this number as "N members told".
      const notifiedUsers = await this.notify(tx, { affected, kind: DISPOSITION_NOTICE_KIND[input.disposition], reportId, reason: input.reason, auditId, occurredAt: now, actorUserId });
      return { reportId, status, disposition: input.disposition, notifiedUsers, auditId };
    });
  }

  /**
   * Ends a mute before its window closes. A sanction that cannot be undone until
   * it expires is a governance gap, so the reversal is a first-class action —
   * same duty, same reason requirement, same audit and notice.
   */
  async liftMute(actorUserId: string, reportId: string, reason: string) {
    const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      const target = await this.lockReport(tx, actorUserId, reportId, (kind, authorization) => {
        const required = dispositionCapability(kind, "MUTE_MEMBER");
        if (!authorization.capabilities.includes(required)) throw new OperationError("FORBIDDEN", 403);
      });
      const lifted = await tx<Array<{ userId: string }>>`
        UPDATE room.member_mutes SET lifted_by = ${actorUserId}, lifted_at = ${now}
        WHERE report_id = ${reportId} AND lifted_at IS NULL AND muted_until > ${now}
        RETURNING user_id AS "userId"`;
      if (!lifted[0]) throw new OperationError("MUTE_NOT_ACTIVE", 409);
      const affected = new Map<string, NoticeAudienceRole>([[lifted[0].userId, "SUBJECT"]]);
      if (!affected.has(target.reporterUserId)) affected.set(target.reporterUserId, "REPORTER");
      await this.audit(tx, { auditId, actorUserId, action: "MEMBER_UNMUTED", targetId: reportId, occurredAt: now, metadata: { reportId, reason } });
      await this.notify(tx, { affected, kind: "MEMBER_UNMUTED", reportId, reason, auditId, occurredAt: now, actorUserId });
      return { reportId, lifted: true as const, auditId };
    });
  }

  /**
   * Files a report against a single chat message. The reporter must be a member
   * of the room the message was sent in; the chat surface that offers this action
   * arrives with Story 12.3, and this is the write path it will call.
   */
  async reportMessage(input: { messageId: string; roomId: string; reporterUserId: string; subjectUserId: string; reason: string; excerpt: string; sentAt: Date }) {
    const reportId = randomUUID(); const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      const inserted = await tx<Array<{ reportId: string; status: ReportStatus }>>`
        INSERT INTO room.reports (id,room_id,kind,message_id,subject_user_id,reported_excerpt,message_sent_at,reporter_user_id,reason,status,severity,created_at,updated_at)
        SELECT ${reportId},r.id,'MESSAGE',${input.messageId},${input.subjectUserId},${input.excerpt},${input.sentAt.toISOString()},${input.reporterUserId},${input.reason},'OPEN','NORMAL',${now},${now}
        FROM room.rooms r JOIN room.members m ON m.room_id = r.id
        WHERE r.id = ${input.roomId} AND m.user_id = ${input.reporterUserId}
        ON CONFLICT DO NOTHING
        RETURNING id AS "reportId", status`;
      if (!inserted[0]) {
        // Either the reporter is not in that room, or they already have this
        // message open in the queue. Both are refusals, not silent successes.
        const [existing] = await tx<Array<{ id: string }>>`
          SELECT id FROM room.reports WHERE kind='MESSAGE' AND message_id=${input.messageId}
            AND reporter_user_id=${input.reporterUserId} AND status IN ('OPEN','ASSIGNED') LIMIT 1`;
        throw existing ? new OperationError("REPORT_ALREADY_OPEN", 409) : new OperationError("ROOM_NOT_FOUND", 404);
      }
      // The room goes in the target columns, not the metadata. `history()` returns
      // metadata but not the target, so a `roomId` here would have handed the room
      // identifier to a community moderator through this report's own timeline —
      // exactly what the message projection withholds (FR83). Targeting the room
      // keeps the filing findable when auditing that room, and the timeline still
      // picks the row up by its `reportId` metadata.
      await this.audit(tx, { auditId, actorUserId: input.reporterUserId, action: "MESSAGE_REPORTED", targetType: "ROOM", targetId: input.roomId, occurredAt: now, metadata: { reportId } });
      return inserted[0];
    });
  }

  /** An account's own governance notices — the explanations owed to them (AC4). */
  async listNotices(userId: string) {
    const rows = await this.sql<Array<{ id: string; kind: GovernanceNoticeKind; reason: string; createdAt: DbTimestamp; readAt: DbTimestamp | null }>>`
      SELECT id, kind, reason, created_at AS "createdAt", read_at AS "readAt"
      FROM ops.governance_notices WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
    return rows.map((row) => ({ id: row.id, kind: row.kind, reason: row.reason, createdAt: timestampIso(row.createdAt), readAt: row.readAt ? timestampIso(row.readAt) : null }));
  }

  /**
   * Marking a notice read is idempotent: the first read stamps the time, a repeat
   * returns the stamp already there. Only a notice that is missing or belongs to
   * someone else is a 404 — reporting "already read" as "not found" made a double
   * tap look like the notice had disappeared.
   */
  async markNoticeRead(userId: string, noticeId: string) {
    const now = this.clock.now().toISOString();
    const [updated] = await this.sql<Array<{ id: string; readAt: DbTimestamp }>>`
      UPDATE ops.governance_notices SET read_at = COALESCE(read_at, ${now})
      WHERE id = ${noticeId} AND user_id = ${userId} RETURNING id, read_at AS "readAt"`;
    if (!updated) throw new OperationError("NOTICE_NOT_FOUND", 404);
    return { id: updated.id, readAt: timestampIso(updated.readAt) };
  }

  /**
   * Locks the report and authorizes the caller against its kind, inside the
   * transaction that is about to mutate state. `authorize` receives the live
   * authorization, so the duty is re-read per request and a revocation takes
   * effect on the operator's very next action.
   */
  private async lockReport(tx: OperatorSql, actorUserId: string, reportId: string, authorize: (kind: ReportKind, authorization: OperatorAuthorization) => void): Promise<ReportTargetRow> {
    const authorization = await readOperatorAuthorization(tx, actorUserId);
    const visible = visibleReportKinds(authorization.capabilities);
    const [row] = await tx<ReportTargetRow[]>`
      SELECT rp.id AS "reportId", rp.kind, rp.status, rp.reporter_user_id AS "reporterUserId",
        rp.assigned_to AS "assignedTo",
        rp.room_id AS "roomId", r.name AS "roomName", r.status AS "roomStatus", r.created_by AS "roomOwnerId",
        rp.message_id AS "messageId", rp.subject_user_id AS "subjectUserId"
      FROM room.reports rp JOIN room.rooms r ON r.id = rp.room_id
      WHERE rp.id = ${reportId} FOR UPDATE OF rp`;
    if (!row || !visible.includes(row.kind)) throw new OperationError("REPORT_NOT_FOUND", 404);
    authorize(row.kind, authorization);
    return row;
  }

  /** Returns how many notices were actually written, which is what the console reports. */
  private async notify(tx: OperatorSql, input: { affected: Map<string, NoticeAudienceRole>; kind: GovernanceNoticeKind; reportId: string; reason: string; auditId: string; occurredAt: string; actorUserId: string }) {
    let notified = 0;
    for (const [userId, role] of input.affected) {
      // The operator does not need to be told about their own decision.
      if (userId === input.actorUserId) continue;
      await tx`INSERT INTO ops.governance_notices (id,user_id,kind,audience_role,report_id,reason,audit_id,created_at)
        VALUES (${randomUUID()},${userId},${input.kind},${role},${input.reportId},${input.reason},${input.auditId},${input.occurredAt})`;
      notified++;
    }
    return notified;
  }

  private async audit(tx: OperatorSql, input: { auditId: string; actorUserId: string; action: string; targetId: string; occurredAt: string; metadata: Record<string, unknown>; targetType?: "REPORT" | "ROOM" }) {
    // `::text::jsonb`, never a bare `::jsonb`: postgres.js would encode the JSON
    // a second time and store a jsonb *string*, breaking metadata->>'reportId'.
    await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
      VALUES (${input.auditId},${input.actorUserId},${input.action},${input.targetType ?? "REPORT"},${input.targetId},'SUCCESS',${JSON.stringify(input.metadata)}::text::jsonb,${input.occurredAt})`;
  }

  /**
   * Shared queue projection. Identity, the reporter's own words, triage state and
   * timestamps leave the database — no stake, no selection, no ledger figure, and
   * for a message report no room identifier the moderator has no duty over.
   */
  private reportSelect() {
    return this.sql`
      SELECT rp.id AS "reportId", rp.kind, rp.severity, rp.status, rp.reason,
        rp.reporter_user_id AS "reporterUserId",
        COALESCE(reporter.nickname, reporter.username_canonical) AS reporter,
        rp.assigned_to AS "assignedTo",
        COALESCE(assignee.nickname, assignee.username_canonical) AS assignee,
        CASE WHEN rp.kind = 'MESSAGE' THEN COALESCE(subject.nickname, subject.username_canonical) ELSE r.name END AS subject,
        rp.created_at AS "createdAt", rp.updated_at AS "updatedAt"
      FROM room.reports rp
      JOIN room.rooms r ON r.id = rp.room_id
      JOIN identity.users reporter ON reporter.id = rp.reporter_user_id
      LEFT JOIN identity.users assignee ON assignee.id = rp.assigned_to
      LEFT JOIN identity.users subject ON subject.id = rp.subject_user_id`;
  }

  private async roomContext(reportId: string) {
    const [row] = await this.sql<Array<{ roomId: string; roomName: string; roomStatus: string; memberCount: number; openReportCount: number }>>`
      SELECT r.id AS "roomId", r.name AS "roomName", r.status AS "roomStatus",
        (SELECT COUNT(*)::int FROM room.members m WHERE m.room_id = r.id) AS "memberCount",
        (SELECT COUNT(*)::int FROM room.reports o WHERE o.room_id = r.id AND o.kind='ROOM' AND o.status IN ('OPEN','ASSIGNED')) AS "openReportCount"
      FROM room.reports rp JOIN room.rooms r ON r.id = rp.room_id WHERE rp.id = ${reportId} LIMIT 1`;
    if (!row) throw new OperationError("REPORT_NOT_FOUND", 404);
    return { ...row, memberCount: Number(row.memberCount), openReportCount: Number(row.openReportCount) };
  }

  /**
   * The reported message and nothing around it: no thread, no neighbours, no room
   * identifier (FR83). The body is the snapshot taken when the report was filed,
   * so judging it never requires read access to the live conversation.
   */
  private async messageContext(reportId: string) {
    const now = this.clock.now();
    const [row] = await this.sql<Array<{ messageId: string; roomName: string; author: string; body: string; sentAt: DbTimestamp; hidden: boolean; mutedUntil: DbTimestamp | null }>>`
      SELECT rp.message_id AS "messageId", r.name AS "roomName",
        COALESCE(subject.nickname, subject.username_canonical) AS author,
        rp.reported_excerpt AS body, rp.message_sent_at AS "sentAt",
        COALESCE(mm.state = 'HIDDEN', false) AS hidden,
        (SELECT MAX(mu.muted_until) FROM room.member_mutes mu
          WHERE mu.room_id = rp.room_id AND mu.user_id = rp.subject_user_id AND mu.lifted_at IS NULL) AS "mutedUntil"
      FROM room.reports rp
      JOIN room.rooms r ON r.id = rp.room_id
      JOIN identity.users subject ON subject.id = rp.subject_user_id
      LEFT JOIN room.message_moderation mm ON mm.message_id = rp.message_id
      WHERE rp.id = ${reportId} LIMIT 1`;
    if (!row) throw new OperationError("REPORT_NOT_FOUND", 404);
    const mutedUntil = row.mutedUntil ? timestampDate(row.mutedUntil) : null;
    return {
      messageId: row.messageId,
      roomName: row.roomName,
      author: row.author,
      body: row.body,
      sentAt: timestampDate(row.sentAt),
      hidden: row.hidden,
      mutedUntil: isMuteActive(mutedUntil, now) ? mutedUntil : null,
    };
  }

  /** This report's own trail, oldest first, so the operator reads it as a story. */
  private async history(reportId: string): Promise<ReportHistoryEntry[]> {
    const legacy = `%"reportId":"${reportId}"%`;
    // Selected newest-first so the cap drops the oldest events, then reversed for
    // reading. Ordering ASC before the LIMIT threw away the most recent
    // dispositions — the part of the trail an operator actually came for.
    const rows = await this.sql<GovernanceAuditRow[]>`
      SELECT * FROM (
        SELECT a.id::text AS id, COALESCE(u.nickname, u.username_canonical) AS actor, a.action,
          a.target_type, a.target_id, a.result, a.metadata, a.occurred_at
        FROM ops.audit_events a LEFT JOIN identity.users u ON u.id = a.actor_user_id
        WHERE (a.target_type = 'REPORT' AND a.target_id = ${reportId})
          OR (jsonb_typeof(a.metadata) = 'object' AND a.metadata->>'reportId' = ${reportId})
          -- Filings written before the double-encoding fix stored the object as a
          -- jsonb string; match those too rather than losing the first event.
          OR (jsonb_typeof(a.metadata) = 'string' AND a.metadata #>> '{}' LIKE ${legacy})
        ORDER BY a.occurred_at DESC, a.id ASC LIMIT 50
      ) recent ORDER BY recent.occurred_at ASC, recent.id ASC`;
    return rows.map((row) => {
      const normalized = normalizeAuditEvent(row);
      return { id: normalized.id, action: normalized.action, actor: normalized.actor, result: normalized.result, metadata: normalized.metadata, occurredAt: new Date(normalized.occurredAt) };
    });
  }

  private toSummary(row: ReportRow, actorUserId: string): ReportSummary {
    return {
      reportId: row.reportId,
      kind: row.kind,
      severity: row.severity,
      status: row.status,
      reason: row.reason,
      reporter: row.reporter,
      assignee: row.assignee,
      assignedToMe: row.assignedTo === actorUserId,
      subject: row.subject,
      createdAt: timestampDate(row.createdAt),
      updatedAt: timestampDate(row.updatedAt),
    };
  }

  private async authorization(actorUserId: string): Promise<OperatorAuthorization> {
    return readOperatorAuthorization(this.sql, actorUserId);
  }
}

function timestampDate(value: DbTimestamp) { return value instanceof Date ? value : new Date(value); }
function timestampIso(value: DbTimestamp) { return timestampDate(value).toISOString(); }

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current !== "object") break;
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    if (typeof candidate.message === "string" && candidate.message.includes("duplicate key value violates unique constraint")) return true;
    current = candidate.cause;
  }
  return false;
}
