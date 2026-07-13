"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@/components/status-message";
export function ChangePasswordForm() {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/v1/auth/change-password", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) }); const result = await response.json().catch(() => ({})) as { error?: { message?: string } }; if (!response.ok) { setError(result.error?.message || "无法修改密码。"); return; } router.replace("/rooms"); }
    catch { setError("网络连接失败，请重试。"); } finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-5">{error && <StatusMessage tone="error" title="修改失败">{error}</StatusMessage>}<label className="block text-sm font-bold">当前初始密码<input name="currentPassword" type="password" autoComplete="current-password" required minLength={12} maxLength={128} className="mt-2 min-h-12 w-full border border-[var(--line)] px-3"/></label><label className="block text-sm font-bold">新密码<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-2 min-h-12 w-full border border-[var(--line)] px-3"/></label><button disabled={pending} className="min-h-12 w-full bg-[var(--field)] px-5 font-bold text-white disabled:opacity-60">{pending ? "正在更新…" : "更新密码并继续"}</button></form>;
}
