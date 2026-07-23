/** Story 7.3b — offline draft discipline for prediction slips.
 *
 *  While offline, an in-progress pick (market + selection + stake) is saved locally so
 *  the reconnect reload (7.3a) doesn't lose it. Drafts are NEVER submitted
 *  automatically: restoring one still requires the user to press submit, and when the
 *  odds, the market or the event state moved while offline the user must re-pick or
 *  explicitly discard. Drafts share the private cache's owner discipline — logout,
 *  account deletion and user switching purge them (see private-cache.ts).
 */

export type OfflineDraft = {
  v: 1;
  roomId: string;
  /** football: match id; F1: `f1:<sessionId>` — same key the tickets endpoint takes. */
  eventKey: string;
  marketId: string;
  marketVersion: string;
  selection: string;
  decimalOdds: string;
  stakePoints: string;
  savedAt: string;
};

const DRAFT_PREFIX = "pulse-draft-v1:";
const DRAFT_FIELDS = ["roomId", "eventKey", "marketId", "marketVersion", "selection", "decimalOdds", "stakePoints", "savedAt"] as const;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function draftKey(roomId: string, eventKey: string): string {
  return `${DRAFT_PREFIX}${roomId}:${eventKey}`;
}

export function saveOfflineDraft(draft: OfflineDraft): void {
  try {
    storage()?.setItem(draftKey(draft.roomId, draft.eventKey), JSON.stringify(draft));
  } catch { /* 配额满/隐私模式：草稿只是便利，绝不阻断页面。 */ }
}

export function loadOfflineDraft(roomId: string, eventKey: string): OfflineDraft | null {
  try {
    const raw = storage()?.getItem(draftKey(roomId, eventKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineDraft> | null;
    if (!parsed || parsed.v !== 1) return null;
    for (const field of DRAFT_FIELDS) {
      if (typeof parsed[field] !== "string" || !parsed[field]) return null;
    }
    return parsed as OfflineDraft;
  } catch {
    return null;
  }
}

export function discardOfflineDraft(roomId: string, eventKey: string): void {
  try {
    storage()?.removeItem(draftKey(roomId, eventKey));
  } catch { /* ignore */ }
}

export function hasOfflineDrafts(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    for (let i = 0; i < store.length; i += 1) {
      if (store.key(i)?.startsWith(DRAFT_PREFIX)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Delete every offline draft (logout / account deletion / ownership change). */
export function purgeOfflineDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch { /* ignore */ }
}

export type DraftVerdict = "UNCHANGED" | "ODDS_CHANGED" | "MARKET_CHANGED" | "EVENT_CLOSED";

/** Revalidate a stored draft against the CURRENT server state of its market (7.3b).
 *  Only a completely unmoved market may be restored as a submittable pick; anything
 *  else demands an explicit re-pick or discard — never a silent submit. */
export function revalidateDraft(draft: OfflineDraft, current: {
  open: boolean;
  marketId?: string | number;
  marketVersion?: string;
  /** Current odds of the draft's selection; undefined when the selection no longer exists. */
  decimalOdds?: string;
}): DraftVerdict {
  if (!current.open) return "EVENT_CLOSED";
  if (current.marketId === undefined || String(current.marketId) !== draft.marketId) return "MARKET_CHANGED";
  if (current.marketVersion !== draft.marketVersion || current.decimalOdds !== draft.decimalOdds) return "ODDS_CHANGED";
  return "UNCHANGED";
}
