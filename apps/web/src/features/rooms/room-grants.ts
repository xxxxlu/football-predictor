/** Room grant flow logic (Story 8.1) — kept out of the view for testability. */

export type GrantStatus = "OPEN" | "APPROVED" | "DENIED";

export type GrantRecord = {
  id: string;
  roomId: string;
  requester: { userId: string; displayName: string };
  note: string | null;
  status: GrantStatus;
  requestedAt: string;
  decidedAt: string | null;
  approvedAmount: string | null;
  decisionNote: string | null;
};

export type GrantList = { isOwner: boolean; requests: GrantRecord[] };

export const GRANT_ERROR_MESSAGES: Record<string, string> = {
  GRANT_REQUEST_EXISTS: "你已有一条待处理的补分申请，等房主处理后再试。",
  GRANT_ALREADY_DECIDED: "这条申请已被处理，刷新后可查看结果。",
  GRANT_AMOUNT_INVALID: "补分数量须为 1 到 20,000 之间的整数。",
  GRANT_NOTE_TOO_LONG: "说明请控制在 200 字以内。",
  ROOM_NOT_ACTIVE: "房间当前不在开放状态，暂不能申请或审批补分。",
  GRANT_NOT_FOUND: "找不到这条补分申请。",
  ROOM_NOT_FOUND: "找不到这个房间，或你已不再是成员。",
};

export function grantErrorMessage(code: string | undefined, fallback: string): string {
  return (code && GRANT_ERROR_MESSAGES[code]) || fallback;
}

export function grantListRequest(roomId: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/grants`, init: { credentials: "same-origin" as const } };
}

export function grantCreateRequest(roomId: string, note: string) {
  const trimmed = note.trim();
  return {
    url: `/api/v1/rooms/${encodeURIComponent(roomId)}/grants`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify(trimmed ? { note: trimmed } : {}),
    },
  };
}

export function grantDecisionRequest(roomId: string, grantId: string, decision: { action: "APPROVE"; amount: number; note?: string } | { action: "DENY"; note?: string }) {
  const note = decision.note?.trim();
  return {
    url: `/api/v1/rooms/${encodeURIComponent(roomId)}/grants/${encodeURIComponent(grantId)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ action: decision.action, ...(decision.action === "APPROVE" ? { amount: decision.amount } : {}), ...(note ? { note } : {}) }),
    },
  };
}

/**
 * Redaction makes ownership inference safe for a non-owner: the only OPEN or
 * DENIED rows the server ever hands a plain member are their own, so "my
 * pending request" is simply the OPEN row (FR44: everyone's APPROVED rows are
 * public inside the room).
 */
export function splitGrantList(list: GrantList) {
  const open = list.requests.filter((row) => row.status === "OPEN");
  const approved = list.requests.filter((row) => row.status === "APPROVED");
  const denied = list.requests.filter((row) => row.status === "DENIED");
  return { open, approved, denied, minePending: list.isOwner ? undefined : open[0] };
}

/** FR44: grants show publicly with per-member counts and totals. */
export function summarizeApprovedGrants(requests: GrantRecord[]) {
  const byMember = new Map<string, { userId: string; displayName: string; count: number; totalPoints: number }>();
  for (const row of requests) {
    if (row.status !== "APPROVED" || row.approvedAmount === null) continue;
    const entry = byMember.get(row.requester.userId) ?? { userId: row.requester.userId, displayName: row.requester.displayName, count: 0, totalPoints: 0 };
    entry.count += 1;
    entry.totalPoints += Number(row.approvedAmount);
    byMember.set(row.requester.userId, entry);
  }
  return [...byMember.values()].sort((a, b) => b.totalPoints - a.totalPoints || a.displayName.localeCompare(b.displayName));
}
