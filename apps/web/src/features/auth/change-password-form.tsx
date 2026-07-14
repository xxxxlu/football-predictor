"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@/components/status-message";
import { logoutForcedPasswordSession } from "./forced-password-flow";
export function ChangePasswordForm() {
  const router = useRouter(); const [pending, setPending] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/v1/auth/change-password", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) }); const result = await response.json().catch(() => ({})) as { error?: { message?: string } }; if (!response.ok) { setError(result.error?.message || "无法修改密码。"); return; } router.replace("/rooms"); }
    catch { setError("网络连接失败，请重试。"); } finally { setPending(false); }
  }
  async function logout() {
    setLoggingOut(true); setError("");
    try { const result = await logoutForcedPasswordSession(); router.replace(result.redirectTo); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法退出当前账户。"); }
    finally { setLoggingOut(false); }
  }
  return <form onSubmit={submit} className="space-y-5">{error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}<label className="block text-sm font-bold">当前初始密码<input name="currentPassword" type="password" autoComplete="current-password" required minLength={12} maxLength={128} className="mt-2 min-h-12 w-full border border-[var(--line)] px-3"/></label><label className="block text-sm font-bold">新密码<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 min-h-12 w-full border border-[var(--line)] px-3"/></label><button disabled={pending || loggingOut} className="min-h-12 w-full bg-[var(--field)] px-5 font-bold text-white disabled:opacity-60">{pending ? "正在更新…" : "更新密码并继续"}</button><button type="button" onClick={logout} disabled={pending || loggingOut} className="min-h-12 w-full border border-[var(--ink)] px-5 font-bold disabled:opacity-60">{loggingOut ? "正在退出…" : "退出当前账户"}</button><p className="text-xs leading-5 text-[var(--muted)]">暂不修改时可以安全退出；重新登录后仍需完成初始密码更新。</p></form>;
}
