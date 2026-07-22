"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusMessage } from "@/components/status-message";
import { recoveryReceiptContinueHref, safeReturnTo } from "./navigation";
import { authErrorMessage } from "./auth-error-messages";

type Mode = "login" | "register" | "recover";
type ApiError = { error?: { code?: string; message?: string; correlationId?: string } };
type ApiSuccess = { data?: { recoveryCode?: string; redirectTo?: string; mustChangePassword?: boolean } };

export function AuthForm({ mode, returnTo }: { mode: Mode; returnTo?: string }) {
  const router = useRouter(); const baseId = useId();
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [recoveryCode, setRecoveryCode] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget); const password = String(form.get("password") || "");
    const payload: Record<string, unknown> = { username: String(form.get("username") || ""), password };
    if (mode === "register") { payload.ageConfirmed = form.get("ageConfirmed") === "on"; payload.nonCashTermsAccepted = form.get("nonCashTermsAccepted") === "on"; }
    if (mode === "recover") { payload.recoveryCode = String(form.get("recoveryCode") || ""); payload.newPassword = password; delete payload.password; }
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as ApiError & ApiSuccess;
      if (!response.ok) { setError(authErrorMessage(result.error?.code)); return; }
      if (result.data?.recoveryCode) { setRecoveryCode(result.data.recoveryCode); return; }
      router.replace(result.data?.mustChangePassword ? "/change-password" : safeReturnTo(returnTo || result.data?.redirectTo));
    } catch { setError("网络连接失败。你的账户和积分没有发生变化，请检查网络后重试。"); } finally { setPending(false); }
  }
  if (recoveryCode) return <RecoveryReceipt code={recoveryCode} continueHref={recoveryReceiptContinueHref(returnTo)} />;
  return <form onSubmit={submit} className="space-y-5" aria-describedby={error ? `${baseId}-error` : undefined}>
    {error && <div id={`${baseId}-error`}><StatusMessage tone="error" title="未能完成">{error}</StatusMessage></div>}
    <Field id={`${baseId}-username`} name="username" label="用户名" autoComplete="username" minLength={3} maxLength={32} hint="3–32 个字符" />
    {mode === "recover" && <Field id={`${baseId}-code`} name="recoveryCode" label="恢复码" autoComplete="off" required hint="输入保存的完整恢复码" />}
    <Field id={`${baseId}-password`} name="password" type="password" label={mode === "recover" ? "新密码" : "密码"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} hint={mode === "login" ? undefined : "12–128 个字符"} />
    {mode === "register" && <fieldset className="space-y-3 border-t rule pt-5"><legend className="sr-only">使用规则确认</legend><Check name="ageConfirmed">我确认已满 18 岁。</Check><Check name="nonCashTermsAccepted">我理解本服务仅使用虚拟积分，不支持充值、提现或兑换。</Check></fieldset>}
    <button disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-5 py-3 font-bold text-white transition hover:bg-[var(--field-dark)] disabled:cursor-wait disabled:opacity-60">{pending ? "正在安全处理…" : mode === "login" ? "登录" : mode === "register" ? "创建账户" : "重置密码并轮换恢复码"}</button>
  </form>;
}

function Field({ id, label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) { return <div><label htmlFor={id} className="mb-2 block text-sm font-bold">{label}</label><input id={id} required {...props} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-base shadow-inner outline-none focus:border-[var(--focus)]"/>{hint && <p className="mt-1.5 text-xs text-[var(--muted)]">{hint}</p>}</div>; }
function Check({ name, children }: { name: string; children: React.ReactNode }) { return <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input required type="checkbox" name={name} className="mt-1 size-5 shrink-0 accent-[var(--field)]"/><span>{children}</span></label>; }
function RecoveryReceipt({ code, continueHref }: { code: string; continueHref: string }) { const [copied, setCopied] = useState(false); return <div><StatusMessage tone="success" title="账户已准备好">恢复码只显示这一次，请立即保存。</StatusMessage><div className="mt-5 rounded-xl border-2 border-dashed border-[var(--ink)] bg-white p-5"><p className="text-xs font-bold text-[var(--muted)]">你的恢复码</p><code className="mt-3 block break-all text-lg font-bold tracking-wider">{code}</code></div><button type="button" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">{copied ? "已复制，请妥善保存" : "复制恢复码"}</button><button type="button" onClick={() => window.location.assign(continueHref)} disabled={!copied} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-5 font-bold text-white transition hover:brightness-95 disabled:opacity-45">我已保存，去登录</button><p className="mt-3 text-xs leading-5 text-[var(--muted)]">为避免意外丢失，复制后才能继续。系统不会再次显示此恢复码。</p></div>; }
