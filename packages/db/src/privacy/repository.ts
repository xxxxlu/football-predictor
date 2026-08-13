import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { redactAuditMetadata } from "../operations/moderation-privacy.js";
import { OperationError } from "../operations/repository.js";

export type DataType = "PHOTO" | "LOCATION" | "DEVICE_INFO" | "PREFERENCES";

export interface ConsentRecord {
  id: string;
  userId: string;
  dataType: DataType;
  consented: boolean;
  consentedAt: string;
  updatedAt: string;
}

export interface CollectedDataRecord {
  id: string;
  userId: string;
  dataType: DataType;
  data: unknown;
  collectedAt: string;
}

/**
 * How many rows one member may file per data type. PHOTO matches the avatar
 * quota exactly (5/h, 20/d) because it is the same act — a member sending the
 * product a picture of themselves — and it is the row that costs megabytes. The
 * three light types are generous enough that no honest client trips them: the
 * privacy centre writes one on an explicit button press, and login writes two.
 */
const COLLECTION_QUOTA: Record<DataType, { perHour: number; perDay: number }> = {
  PHOTO: { perHour: 5, perDay: 20 },
  LOCATION: { perHour: 60, perDay: 300 },
  DEVICE_INFO: { perHour: 60, perDay: 300 },
  PREFERENCES: { perHour: 60, perDay: 300 },
};

export class PostgresPrivacyRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  /**
   * Record the baseline privacy consent required at login and persist the
   * browser/device snapshot in the same transaction. Sensitive photo and
   * precise-location access remain separate, just-in-time permissions.
   *
   * A revocation made in the privacy centre outlives every later login. The
   * upsert therefore establishes the baseline only on the *first* login (the
   * insert); an existing row keeps whatever the member last chose. The earlier
   * `DO UPDATE SET consented = true` silently re-granted a duty the member had
   * explicitly switched off, and then collected against it on the same request.
   * Collection now follows the stored decision rather than the login: a data
   * type whose consent is off is skipped, so the returned array is shorter than
   * the baseline instead of carrying unauthorized rows.
   */
  async recordLoginConsent(
    userId: string,
    deviceInfo: unknown,
    preferences: unknown,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<CollectedDataRecord[]> {
    const now = this.clock.now().toISOString();
    const baseline = [
      ["DEVICE_INFO", deviceInfo],
      ["PREFERENCES", preferences],
    ] as const satisfies ReadonlyArray<readonly [DataType, unknown]>;

    return this.sql.begin(async (sql) => {
      const granted = new Map<DataType, string>();
      for (const [dataType] of baseline) {
        // `DO UPDATE SET updated_at = <its own value>` is deliberate: it makes
        // the conflicting row visible to RETURNING without changing it, so the
        // member's own choice and its original consented_at survive untouched.
        // A plain DO NOTHING returns no row at all and so could not tell
        // "already granted" apart from "explicitly revoked".
        const [consent] = await sql<Array<{ id: string; consented: boolean }>>`
          INSERT INTO privacy.consent (id, user_id, data_type, consented, consented_at, updated_at)
          VALUES (${randomUUID()}, ${userId}, ${dataType}, true, ${now}, ${now})
          ON CONFLICT (user_id, data_type)
          DO UPDATE SET updated_at = privacy.consent.updated_at
          RETURNING id, consented`;
        if (!consent) throw new Error(`CONSENT_UPSERT_FAILED: ${dataType}`);
        if (consent.consented) granted.set(dataType, consent.id);
      }

      const records: CollectedDataRecord[] = [];
      for (const [dataType, data] of baseline) {
        const consentId = granted.get(dataType);
        if (!consentId) continue;
        const [row] = await sql<Array<{
          id: string; userId: string; dataType: DataType;
          data: unknown; collectedAt: Date;
        }>>`
          INSERT INTO privacy.collected_data
            (id, user_id, data_type, consent_id, data, ip_address, user_agent, collected_at)
          VALUES
            (${randomUUID()}, ${userId}, ${dataType}, ${consentId}, ${JSON.stringify(data)}::jsonb,
             ${ipAddress ?? null}, ${userAgent ?? null}, ${now})
          RETURNING id, user_id AS "userId", data_type AS "dataType",
                    data, collected_at AS "collectedAt"`;
        if (!row) throw new Error(`COLLECTED_DATA_INSERT_FAILED: ${dataType}`);
        records.push({ ...row, collectedAt: isoTimestampValue(row.collectedAt) });
        await pruneUnreachable(sql, userId, dataType);
      }
      return records;
    });
  }

  /**
   * Get all consent records for a user.
   */
  async listConsent(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.sql<Array<{
      id: string; userId: string; dataType: DataType; consented: boolean;
      consentedAt: Date; updatedAt: Date;
    }>>`
      SELECT id, user_id AS "userId", data_type AS "dataType", consented,
             consented_at AS "consentedAt", updated_at AS "updatedAt"
      FROM privacy.consent
      WHERE user_id = ${userId}
      ORDER BY data_type`;
    return rows.map(isoTimestamp);
  }

  /**
   * Upsert a consent record — insert or update existing.
   */
  async upsertConsent(userId: string, dataType: DataType, consented: boolean): Promise<ConsentRecord> {
    const now = this.clock.now().toISOString();
    const [row] = await this.sql<Array<{
      id: string; userId: string; dataType: DataType; consented: boolean;
      consentedAt: Date; updatedAt: Date;
    }>>`
      INSERT INTO privacy.consent (id, user_id, data_type, consented, consented_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, ${dataType}, ${consented}, ${now}, ${now})
      ON CONFLICT (user_id, data_type)
      DO UPDATE SET
        consented = ${consented},
        consented_at = CASE
          WHEN ${consented} = true AND privacy.consent.consented = false THEN ${now}
          ELSE privacy.consent.consented_at
        END,
        updated_at = ${now}
      RETURNING id, user_id AS "userId", data_type AS "dataType", consented,
                consented_at AS "consentedAt", updated_at AS "updatedAt"`;
    if (!row) throw new Error("CONSENT_UPSERT_FAILED");
    return isoTimestamp(row);
  }

  /**
   * Check if user has active consent for a data type.
   */
  async hasConsent(userId: string, dataType: DataType): Promise<boolean> {
    const [row] = await this.sql<Array<{ consented: boolean }>>`
      SELECT consented FROM privacy.consent
      WHERE user_id = ${userId} AND data_type = ${dataType} AND consented = true
      LIMIT 1`;
    return row?.consented ?? false;
  }

  /**
   * Store collected data for a user, priced against the per-type quota.
   *
   * Every other member-facing write in the product is quota'd — avatar changes,
   * room and club chat, friend requests, lobby writes. These four endpoints were
   * the only ones that were not, and they are the ones that grow storage without
   * bound: a consenting member could file unlimited multi-megabyte PHOTO rows,
   * and every login already files two more. The count and the insert share one
   * transaction behind a per-user advisory lock, copied from the avatar quota
   * (identity/avatars.ts) for the same reason: without the lock N parallel
   * requests each read "under the limit" and all proceed.
   *
   * Unlike the avatar quota this one is *not* committed separately, because the
   * thing being rationed here is the stored row itself — a submission that fails
   * to store has cost nothing to ration.
   */
  async storeCollectedData(userId: string, dataType: DataType, data: unknown, ipAddress?: string, userAgent?: string): Promise<CollectedDataRecord> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const hourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
    const dayAgoIso = new Date(now.getTime() - 86_400_000).toISOString();
    const quota = COLLECTION_QUOTA[dataType];

    return this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('privacy-collect:' || ${dataType} || ':' || ${userId}, 0))`;
      const [window] = await sql<Array<{ hourCount: string | number; dayCount: string | number }>>`
        SELECT count(*) FILTER (WHERE collected_at >= ${hourAgoIso}) AS "hourCount", count(*) AS "dayCount"
        FROM privacy.collected_data
        WHERE user_id = ${userId} AND data_type = ${dataType} AND collected_at >= ${dayAgoIso}`;
      if (
        Number(window?.hourCount ?? 0) >= quota.perHour ||
        Number(window?.dayCount ?? 0) >= quota.perDay
      ) {
        throw new OperationError("RATE_LIMITED", 429);
      }

      const [row] = await sql<Array<{
        id: string; userId: string; dataType: DataType;
        data: unknown; collectedAt: Date;
      }>>`
        INSERT INTO privacy.collected_data (id, user_id, data_type, consent_id, data, ip_address, user_agent, collected_at)
        SELECT ${randomUUID()}, ${userId}, ${dataType}, consent.id,
               ${JSON.stringify(data)}::jsonb, ${ipAddress ?? null}, ${userAgent ?? null}, ${nowIso}
        FROM privacy.consent AS consent
        WHERE consent.user_id = ${userId}
          AND consent.data_type = ${dataType}
          AND consent.consented = true
        RETURNING id, user_id AS "userId", data_type AS "dataType",
                  data, collected_at AS "collectedAt"`;
      // Consent is re-read here, inside the transaction, so a revocation that
      // lands between the handler's check and this insert refuses the write.
      // That is a refusal, not a server fault: it used to throw a bare Error and
      // surface as a 500 INTERNAL_ERROR instead of the 403 the caller can act on.
      if (!row) throw new OperationError("CONSENT_REQUIRED", 403);
      await pruneUnreachable(sql, userId, dataType);
      return { ...row, collectedAt: isoTimestampValue(row.collectedAt) };
    });
  }

  /**
   * Get all collected data for a user, grouped by data type.
   */
  async listCollectedData(userId: string, limit = 100): Promise<CollectedDataRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = await this.sql<Array<{
      id: string; userId: string; dataType: DataType;
      data: unknown; collectedAt: Date;
    }>>`
      SELECT id, user_id AS "userId", data_type AS "dataType",
             CASE
               WHEN data_type = 'PHOTO'::privacy.data_type
                 THEN (data - 'dataUrl') || jsonb_build_object('hasPhoto', data ? 'dataUrl')
               ELSE data
             END AS data,
             collected_at AS "collectedAt"
      FROM privacy.collected_data
      WHERE user_id = ${userId}
      ORDER BY collected_at DESC
      LIMIT ${safeLimit}`;
    return rows.map((r) => ({ ...r, collectedAt: isoTimestampValue(r.collectedAt) }));
  }

  /** Delete all data collected for the current user without changing consent choices. */
  async deleteCollectedData(userId: string): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`
      DELETE FROM privacy.collected_data
      WHERE user_id = ${userId}
      RETURNING id`;
    return rows.length;
  }

  /**
   * Get all users' data overview (for admin panel).
   */
  async listAllUsersDataSummary(): Promise<Array<{
    userId: string; username: string; nickname: string | null;
    consentCount: number; dataCount: number; dataTypes: string[];
  }>> {
    const rows = await this.sql<Array<{
      userId: string; username: string; nickname: string | null;
      consentCount: number; dataCount: number; dataTypes: string[];
    }>>`
      SELECT u.id AS "userId", u.username_canonical AS "username", u.nickname,
             COALESCE(c.consent_count, 0)::int AS "consentCount",
             COALESCE(d.data_count, 0)::int AS "dataCount",
             COALESCE(c.data_types, '{}')::text[] AS "dataTypes"
      FROM identity.users u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS consent_count,
               ARRAY_AGG(data_type::text) AS data_types
        FROM privacy.consent WHERE consented = true
        GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS data_count
        FROM privacy.collected_data
        GROUP BY user_id
      ) d ON d.user_id = u.id
      WHERE u.status = 'ACTIVE'
      ORDER BY d.data_count DESC NULLS LAST, u.created_at DESC
      LIMIT 200`;
    return rows;
  }

  /**
   * Get detailed data for a specific user (admin view).
   *
   * Operator-facing, so it runs through the same redaction the governance audit
   * trail uses: precise coordinates never reach the console. That rule is not
   * new here — `redactAuditMetadata` already enforces it for audit metadata
   * (Story 11.4 AC4), and `AUDIENCE_ANALYTICS_READ` exists precisely because
   * location for operators is meant to be coarse. This read is reached with
   * `USER_SECURITY_READ`, a duty a granted OPERATIONS_ADMIN holds, and it was
   * handing back raw latitude/longitude per member — the one operator surface
   * that bypassed the rule. The member's own read (`listCollectedData`) is
   * unchanged: seeing your own coordinates is the point of the privacy centre.
   */
  async getUserDataDetail(userId: string): Promise<{
    consents: ConsentRecord[];
    collectedData: CollectedDataRecord[];
  }> {
    if (!UUID_PATTERN.test(userId)) return { consents: [], collectedData: [] };
    const [consents, collectedData] = await Promise.all([
      this.listConsent(userId),
      this.listCollectedData(userId),
    ]);
    return {
      consents,
      collectedData: collectedData.map((record) => ({ ...record, data: redactAuditMetadata(record.data) })),
    };
  }
}

/**
 * Guards the admin detail read. `user_id` is a uuid column, so a non-uuid path
 * segment reached Postgres as `22P02 invalid input syntax` and surfaced as a 500
 * INTERNAL_ERROR; an unknown user is not a server fault and answers empty, the
 * same shape an existing member with nothing collected returns.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rows per member per data type kept on write.
 *
 * This is a reachability bound, not a retention policy — deciding how long the
 * product *should* keep privacy data is a product call and still open. Every
 * read goes through `listCollectedData`, whose limit is clamped to 200 rows
 * across all four types, so keeping the newest 200 of each type retains a strict
 * superset of everything any code path can return. What it removes is data that
 * no API, no admin console and no export could ever show — a growing liability
 * with no reader. It matters because the login path writes two rows on every
 * single login and nothing anywhere prunes them.
 */
const COLLECTION_REACHABLE_ROWS = 200;

async function pruneUnreachable(sql: postgres.TransactionSql, userId: string, dataType: DataType): Promise<void> {
  await sql`
    DELETE FROM privacy.collected_data
    WHERE user_id = ${userId} AND data_type = ${dataType}
      AND id NOT IN (
        SELECT id FROM privacy.collected_data
        WHERE user_id = ${userId} AND data_type = ${dataType}
        ORDER BY collected_at DESC, id DESC
        LIMIT ${COLLECTION_REACHABLE_ROWS}
      )`;
}

function isoTimestamp(row: {
  id: string; userId: string; dataType: DataType; consented: boolean;
  consentedAt: Date; updatedAt: Date;
}): ConsentRecord {
  return {
    ...row,
    consentedAt: (row.consentedAt instanceof Date ? row.consentedAt : new Date(row.consentedAt)).toISOString(),
    updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
  };
}

function isoTimestampValue(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
