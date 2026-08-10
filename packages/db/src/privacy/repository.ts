import { randomUUID } from "node:crypto";
import type postgres from "postgres";

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

export class PostgresPrivacyRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  /**
   * Record the baseline privacy consent required at login and persist the
   * browser/device snapshot in the same transaction. Sensitive photo and
   * precise-location access remain separate, just-in-time permissions.
   */
  async recordLoginConsent(
    userId: string,
    deviceInfo: unknown,
    preferences: unknown,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<CollectedDataRecord[]> {
    const now = this.clock.now().toISOString();
    const baselineTypes: DataType[] = ["DEVICE_INFO", "PREFERENCES"];

    return this.sql.begin(async (sql) => {
      const consentIds = new Map<DataType, string>();
      for (const dataType of baselineTypes) {
        const [consent] = await sql<Array<{ id: string }>>`
          INSERT INTO privacy.consent (id, user_id, data_type, consented, consented_at, updated_at)
          VALUES (${randomUUID()}, ${userId}, ${dataType}, true, ${now}, ${now})
          ON CONFLICT (user_id, data_type)
          DO UPDATE SET
            consented = true,
            consented_at = CASE
              WHEN privacy.consent.consented = false THEN ${now}
              ELSE privacy.consent.consented_at
            END,
            updated_at = ${now}
          RETURNING id`;
        if (!consent) throw new Error(`CONSENT_UPSERT_FAILED: ${dataType}`);
        consentIds.set(dataType, consent.id);
      }

      const records: CollectedDataRecord[] = [];
      for (const [dataType, data] of [
        ["DEVICE_INFO", deviceInfo],
        ["PREFERENCES", preferences],
      ] as const) {
        const consentId = consentIds.get(dataType);
        if (!consentId) throw new Error(`CONSENT_UPSERT_FAILED: ${dataType}`);
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
   * Store collected data for a user.
   */
  async storeCollectedData(userId: string, dataType: DataType, data: unknown, ipAddress?: string, userAgent?: string): Promise<CollectedDataRecord> {
    const now = this.clock.now().toISOString();
    const [row] = await this.sql<Array<{
      id: string; userId: string; dataType: DataType;
      data: unknown; collectedAt: Date;
    }>>`
      INSERT INTO privacy.collected_data (id, user_id, data_type, consent_id, data, ip_address, user_agent, collected_at)
      SELECT ${randomUUID()}, ${userId}, ${dataType}, consent.id,
             ${JSON.stringify(data)}::jsonb, ${ipAddress ?? null}, ${userAgent ?? null}, ${now}
      FROM privacy.consent AS consent
      WHERE consent.user_id = ${userId}
        AND consent.data_type = ${dataType}
        AND consent.consented = true
      RETURNING id, user_id AS "userId", data_type AS "dataType",
                data, collected_at AS "collectedAt"`;
    if (!row) throw new Error(`NO_CONSENT: ${dataType}`);
    return { ...row, collectedAt: isoTimestampValue(row.collectedAt) };
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
   */
  async getUserDataDetail(userId: string): Promise<{
    consents: ConsentRecord[];
    collectedData: CollectedDataRecord[];
  }> {
    const [consents, collectedData] = await Promise.all([
      this.listConsent(userId),
      this.listCollectedData(userId),
    ]);
    return { consents, collectedData };
  }
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
