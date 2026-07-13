export function moderationReauthRequest(password: string) {
  return { url: "/api/v1/auth/reauthenticate", init: { method: "POST", credentials: "same-origin" as const, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) } };
}
export function moderationActionRequest(roomId: string, action: "RESTRICT" | "CLOSE" | "RESTORE", reason: string) {
  return { url: `/api/v1/admin/rooms/${encodeURIComponent(roomId)}`, init: { method: "PATCH", credentials: "same-origin" as const, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) } };
}
