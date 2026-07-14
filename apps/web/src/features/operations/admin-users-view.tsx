"use client";
import { FormEvent, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { loadAdminUsers, updateAdminUserStatus, type ManagedUser } from "./admin-users-flow";

export function AdminUsersView() {
  const [users, setUsers] = useState<ManagedUser[]>();
  const [target, setTarget] = useState<ManagedUser>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void loadAdminUsers().then((data) => { if (active) setUsers(data); }, (reason: unknown) => { if (active) setError((reason as Error).message || "无法加载用户列表"); }); return () => { active = false; }; }, []);
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!target) return; setBusy(true); setError(""); setSuccess("");
    const form = new FormData(event.currentTarget); const nextStatus = target.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try { const result = await updateAdminUserStatus(fetch, { userId: target.id, status: nextStatus, password: String(form.get("password") || "") }); setUsers((current) => current?.map((user) => user.id === target.id ? { ...user, status: result.status } : user)); setSuccess(`${target.username} 已${result.status === "DISABLED" ? "禁用" : "恢复"}，审计编号 ${result.auditId}`); setTarget(undefined); }
    catch (reason) { setError((reason as Error).message || "账户状态更新失败"); }
    finally { setBusy(false); }
  }
  if (!users && !error) return <DataStatePanel state="loading" title="正在加载普通用户" description=""/>;
  if (!users) return <DataStatePanel state="error" title="用户列表暂不可用" description={error}/>;
  return <div className="space-y-5">{success && <StatusMessage tone="success" title="账户状态已更新">{success}</StatusMessage>}{error && <StatusMessage tone="error" title="操作未完成">{error}</StatusMessage>}<section className="surface p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="display text-2xl font-bold">普通用户</h2><p className="mt-2 text-sm text-[var(--muted)]">禁用会立即撤销该用户全部会话；恢复后用户可以重新登录。</p></div><span className="text-xs text-[var(--muted)]">共 {users.length} 个</span></div>{users.length === 0 ? <p className="mt-5 text-sm text-[var(--muted)]">暂无普通用户。</p> : <ul className="mt-5 divide-y divide-[var(--line)]">{users.map((user) => <li key={user.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><strong>{user.username}</strong><p className="mt-1 text-xs text-[var(--muted)]">{user.status === "ACTIVE" ? "● 已启用" : "■ 已禁用"}</p></div><button type="button" onClick={() => { setTarget(user); setError(""); setSuccess(""); }} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">{user.status === "ACTIVE" ? "禁用账户" : "恢复账户"}</button></li>)}</ul>}</section>{target && <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby="admin-confirm-title"><h2 id="admin-confirm-title" className="display text-xl font-bold">确认{target.status === "ACTIVE" ? "禁用" : "恢复"} {target.username}</h2><p className="mt-2 text-sm text-[var(--muted)]">请输入当前超级管理员密码。身份确认结果最多有效 5 分钟。</p><form onSubmit={confirm} className="mt-5 space-y-4"><label className="block text-sm font-bold">当前管理员密码<input name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} autoFocus className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] px-3"/></label><div className="flex flex-wrap gap-3"><button disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-50">{busy ? "正在确认…" : `确认${target.status === "ACTIVE" ? "禁用" : "恢复"}`}</button><button type="button" disabled={busy} onClick={() => setTarget(undefined)} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">取消</button></div></form></section>}</div>;
}
