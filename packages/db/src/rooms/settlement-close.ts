import postgres from "postgres";

/**
 * A settled room is removed from normal discovery instead of hard-deleted.
 * Ledger, result and audit rows deliberately keep their foreign keys so a result
 * correction can still be applied. CLOSED blocks every future ticket submission.
 */
export class PostgresSettledRoomCloser {
  constructor(private readonly sql: postgres.Sql) {}

  async closeSettledRooms(limit: number, now = new Date()): Promise<{ closed: number; roomIds: string[] }> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.sql<Array<{ id: string }>>`
      WITH candidates AS (
        SELECT r.id
        FROM room.rooms r
        WHERE r.status='ACTIVE'
          AND EXISTS (SELECT 1 FROM prediction.tickets t WHERE t.room_id=r.id AND t.status='SETTLED')
          AND NOT EXISTS (SELECT 1 FROM prediction.tickets t WHERE t.room_id=r.id AND t.status='PENDING')
        ORDER BY r.updated_at,r.id
        LIMIT ${safeLimit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE room.rooms r SET status='CLOSED',updated_at=${now.toISOString()}
      FROM candidates c WHERE r.id=c.id
      RETURNING r.id`;
    return { closed: rows.length, roomIds: rows.map((row) => row.id) };
  }
}

export function createPostgresSettledRoomCloser(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const closer = new PostgresSettledRoomCloser(sql);
  return { closeSettledRooms: (limit: number) => closer.closeSettledRooms(limit), close: () => sql.end() };
}
