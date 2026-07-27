/**
 * Product-deletes completed room contests: they disappear from all room routes
 * and discovery. The CLOSED tombstone retains immutable settlement evidence only
 * so a late upstream result correction remains safe and idempotent.
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const limit = Math.max(1, Math.min(500, Number.parseInt(process.env.ROOM_CLOSE_BATCH_SIZE ?? "500", 10) || 500));
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const rows = await sql`
    WITH candidates AS (
      SELECT r.id
      FROM room.rooms r
      WHERE r.status IN ('ACTIVE','RESTRICTED')
        AND EXISTS (SELECT 1 FROM prediction.tickets t WHERE t.room_id=r.id AND t.status='SETTLED')
        AND NOT EXISTS (SELECT 1 FROM prediction.tickets t WHERE t.room_id=r.id AND t.status='PENDING')
      ORDER BY r.updated_at,r.id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE room.rooms r SET status='CLOSED',updated_at=now()
    FROM candidates c WHERE r.id=c.id
    RETURNING r.id`;
  console.log(`[close-settled-rooms] closed=${rows.length}`);
} finally {
  await sql.end();
}
