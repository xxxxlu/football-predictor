import postgres from "postgres";

/**
 * Rooms are long-lived prediction groups. Settlement completes an event round,
 * not the group itself; the next round becomes available once no ticket remains
 * pending. Historical tickets stay in the account archive.
 */
export class PostgresSettledRoomCloser {
  constructor(private readonly sql: postgres.Sql) {}

  async closeSettledRooms(limit: number, now = new Date()): Promise<{ closed: number; roomIds: string[] }> {
    void limit; void now;
    return { closed: 0, roomIds: [] };
  }
}

export function createPostgresSettledRoomCloser(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const closer = new PostgresSettledRoomCloser(sql);
  return { closeSettledRooms: (limit: number) => closer.closeSettledRooms(limit), close: () => sql.end() };
}
