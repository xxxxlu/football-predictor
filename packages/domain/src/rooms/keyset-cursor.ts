/**
 * Keyset cursor over a `(created_at, id)` pair — the codebase's one cursor
 * encoding (architecture L147 `{data, meta:{cursor}}`), shared by room chat,
 * the club channel and the public-room lobby. Encoded as base64url JSON; a
 * cursor that fails to decode is refused, never silently ignored, so a
 * malformed value cannot hand back page one as if it were the next page.
 */
export interface KeysetCursor {
  createdAt: string;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeKeysetCursor(raw: string): KeysetCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<KeysetCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    if (!UUID_PATTERN.test(parsed.id)) return null;
    const instant = new Date(parsed.createdAt);
    if (Number.isNaN(instant.getTime())) return null;
    // Bind the normalized ISO string, never the raw value: JS accepts date
    // grammars Postgres does not (e.g. "0"), and a raw pass-through turns a
    // tampered cursor into a timestamptz cast error (500) instead of this
    // decoder's refusal (422).
    return { createdAt: instant.toISOString(), id: parsed.id.toLowerCase() };
  } catch {
    return null;
  }
}
