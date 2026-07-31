"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { purgePrivateCaches } from "@/features/pwa/private-cache";

type Profile = { id: string; username: string; nickname: string; roles?: string[]; operatorRoles?: string[]; capabilities?: string[] };
type PrivacyPreferences = { showOnlineToFriends: boolean; showLobbyToFriends: boolean };

/**
 * Back-office entries the account page offers, each behind the capability its
 * API requires. Hiding an entry is a courtesy, not a boundary: every route and
 * every repository re-checks the same capability server-side per request.
 */
const OPERATOR_ENTRIES: Array<{ href: string; label: string; capability: string; primary?: boolean }> = [
  { href: "/admin/users", label: "用户安全", capability: "USER_SECURITY_READ", primary: true },
  // The governance inbox lives on this page and is shared by both restricted
  // duties, so the entry follows the inbox capability rather than the room one —
  // otherwise a community moderator would have no way to reach the only screen
  // their duty exists for. The room-governance section inside simply does not
  // render for them.
  { href: "/admin/moderation", label: "治理收件箱", capability: "ROOM_REPORT_READ" },
  // The overview route itself admits any operational duty, but the entry follows
  // the health capability: a community moderator's only card is the inbox, which
  // they already reach directly above.
  { href: "/admin/status", label: "运营总览", capability: "OPERATIONS_HEALTH_READ" },
  { href: "/admin/operators", label: "运营职责", capability: "OPERATOR_ROLE_MANAGE" },
];
const ROLE_LABELS: Record<string, string> = { SUPER_ADMIN: "超级管理员", OPERATIONS_ADMIN: "运营管理员", COMMUNITY_MODERATOR: "社区协管员" };

export function AccountProfile() {
  const [profile, setProfile] = useState<Profile>(); const [nickname, setNickname] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const [logoutPending, setLogoutPending] = useState(false); const [deletePending, setDeletePending] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyPreferences>(); const [privacySaving, setPrivacySaving] = useState(false); const [privacyError, setPrivacyError] = useState("");
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const response = await fetch("/api/v1/account/profile", { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<Profile> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载账户资料"); setProfile(result.data); setNickname(result.data.nickname); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载账户资料"); } finally { setLoading(false); } })(); return () => controller.abort(); }, []);
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); setSaved(false); try { const response = await fetch("/api/v1/account/profile", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: nickname.trim() }) }); const result = await response.json().catch(() => ({})) as ApiEnvelope<Profile> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法保存昵称"); setProfile(result.data); setNickname(result.data.nickname); setSaved(true); } catch (reason) { setError((reason as Error).message || "无法保存昵称"); } finally { setSaving(false); } }
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const response = await fetch("/api/v1/account/privacy", { credentials: "same-origin", signal: controller.signal }); if (!response.ok) return; const result = await response.json() as ApiEnvelope<PrivacyPreferences>; setPrivacy(result.data); } catch { /* 开关区顺带加载失败时保持隐藏，不打断账户页 */ } })(); return () => controller.abort(); }, []);
  async function togglePrivacy(key: keyof PrivacyPreferences, value: boolean) { if (!privacy) return; const previous = privacy; setPrivacy({ ...privacy, [key]: value }); setPrivacySaving(true); setPrivacyError(""); try { const response = await fetch("/api/v1/account/privacy", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: value }) }); const result = await response.json().catch(() => ({})) as ApiEnvelope<PrivacyPreferences> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法更新展示设置"); setPrivacy(result.data); } catch (reason) { setPrivacy(previous); setPrivacyError((reason as Error).message || "无法更新展示设置"); } finally { setPrivacySaving(false); } }
  async function logout() { setLogoutPending(true); setError(""); try { const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) { const result = await response.json().catch(() => ({})) as ApiFailure; throw new Error(result.error?.message || "退出失败"); } await purgePrivateCaches().catch(() => {}); window.location.assign("/login"); } catch (reason) { setError((reason as Error).message || "退出失败"); setLogoutPending(false); } }
  async function deleteAccount() { if (!window.confirm("删除后无法恢复。积分账本会以匿名身份保留，是否继续？")) return; setDeletePending(true); setError(""); try { const response = await fetch("/api/v1/account", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE" }) }); const result = await response.json().catch(() => ({})) as ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法删除账户"); await purgePrivateCaches().catch(() => {}); window.location.assign("/login?deleted=1"); } catch (reason) { setError((reason as Error).message || "无法删除账户"); setDeletePending(false); } }
  if (loading) return <DataStatePanel state="loading" title="正在加载账户" description=""/>;
  if (!profile) return <DataStatePanel state="error" title="账户资料暂不可用" description={error || "请重新登录后重试。"}/>;
  const isAdmin = Boolean(profile.roles?.includes("super_admin"));
  const capabilities = profile.capabilities ?? [];
  const operatorEntries = OPERATOR_ENTRIES.filter((entry) => capabilities.includes(entry.capability));
  const duties = (profile.operatorRoles ?? []).map((role) => ROLE_LABELS[role] ?? role);
  const isOperator = duties.length > 0;
  return <div className="space-y-6">
    {/* 通行证：昵称是这页唯一属于本人的东西，让它当主体，用户名当证件号。 */}
    <section className="surface overflow-hidden" aria-label="会员通行证">
      <div className="pulse-pass">
        <span aria-hidden="true" className="pulse-pass__wedge"/>
        <span aria-hidden="true" className="pulse-pass__mark">P</span>
        <p className="pulse-pass__eyebrow">PULSE SPORTS CLUB / MEMBER PASS</p>
        <p className="pulse-pass__name">{profile.nickname}</p>
        <div className="pulse-pass__foot">
          <p className="pulse-pass__no">NO. <b>{profile.username}</b></p>
          <span className={`pulse-pass__stamp${isOperator ? " pulse-pass__stamp--admin" : ""}`}><span>{duties.length ? duties.join(" / ") : "普通用户"}</span></span>
        </div>
      </div>
    </section>

    {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}
    {saved && <StatusMessage tone="success" title="昵称已更新"/>}

    <div className="grid gap-5 lg:grid-cols-[1fr_.7fr]">
      <section className="surface p-5 sm:p-7">
        <p className="eyebrow">DISPLAY NAME</p>
        <h2 className="display mt-1 text-2xl font-bold">改一个房间里的名字</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">昵称会显示给同一房间的成员；用户名不会变，登录仍然用它。</p>
        <form onSubmit={save} className="mt-6">
          <label htmlFor="nickname" className="mb-2 block text-sm font-bold">昵称</label>
          <input id="nickname" name="nickname" required minLength={2} maxLength={32} value={nickname} onChange={event => setNickname(event.target.value)} className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-white px-3"/>
          <p className="mt-2 text-xs text-[var(--muted)]">2–32 个字符</p>
          <button disabled={saving || nickname.trim() === profile.nickname} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--field)] px-6 font-bold text-white transition hover:brightness-95 disabled:opacity-45">{saving ? "正在保存…" : "保存昵称"}</button>
        </form>
        <div className="mt-8 border-t border-[var(--line)] pt-6">
          <p className="eyebrow">FRIENDS & PRESENCE</p>
          <h3 className="mt-1 font-bold">好友与在场</h3>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">好友通过你的 PULSE ID（会员号）添加。在线与在大厅的展示默认关闭，只有你主动开启后，互为好友的成员才能看到。</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/friends" className="rounded-full border-2 border-[var(--ink)] px-4 py-2 text-sm font-bold no-underline">好友列表与申请</Link>
          </div>
          {privacy && <div className="mt-4 space-y-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={privacy.showOnlineToFriends} disabled={privacySaving} onChange={event => void togglePrivacy("showOnlineToFriends", event.target.checked)} className="h-5 w-5"/>
              <span><b>向好友展示在线</b><span className="block text-xs text-[var(--muted)]">开启后，互为好友的成员能看到你最近是否活跃。</span></span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={privacy.showLobbyToFriends} disabled={privacySaving} onChange={event => void togglePrivacy("showLobbyToFriends", event.target.checked)} className="h-5 w-5"/>
              <span><b>向好友展示「正在大厅」</b><span className="block text-xs text-[var(--muted)]">大厅上线后生效；现在开启即代表提前同意。</span></span>
            </label>
            {privacyError && <p className="text-xs font-bold text-[var(--coral)]">{privacyError}</p>}
          </div>}
        </div>
        {isOperator && <div className="mt-8 border-t border-[var(--line)] pt-6">
          <p className="eyebrow">OPERATIONS</p>
          <h3 className="mt-1 font-bold">运营入口</h3>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">这里只列出你已获授权的入口，每个接口仍会在服务端逐请求校验权限。为保证账本不可篡改，任何职责都不能覆盖用户余额、改动预测或账本流水。</p>
          {operatorEntries.length
            ? <div className="mt-4 flex flex-wrap gap-3">{operatorEntries.map((entry) => <Link key={entry.href} href={entry.href} className={entry.primary ? "rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white no-underline" : "rounded-full border-2 border-[var(--ink)] px-4 py-2 text-sm font-bold no-underline"}>{entry.label}</Link>)}</div>
            : <p className="mt-4 text-sm text-[var(--muted)]">你当前的职责还没有对应的后台入口。</p>}
        </div>}
      </section>

      <aside className="surface h-fit p-5 sm:p-7">
        <p className="eyebrow">SESSION</p>
        <h2 className="display mt-1 text-2xl font-bold">离开这台设备</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">退出只撤销当前浏览器的会话，不会删除账户、房间或账本；本机的私有缓存会一并清除。</p>
        <button type="button" onClick={logout} disabled={logoutPending} className="mt-6 min-h-12 w-full rounded-full border-2 border-[var(--coral)] px-4 font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-45">{logoutPending ? "正在安全退出…" : "退出当前会话"}</button>
        {!isAdmin && <div className="mt-8 border-t border-[var(--line)] pt-6">
          <h3 className="font-bold text-[var(--coral)]">删除账户</h3>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">公开身份将匿名化，所有会话立即撤销；为保证房间积分可核验，仅保留最小账本和审计记录。</p>
          <button type="button" onClick={deleteAccount} disabled={deletePending} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--coral)] px-4 font-bold text-white transition hover:brightness-95 disabled:opacity-45">{deletePending ? "正在处理…" : "申请并立即删除账户"}</button>
        </div>}
      </aside>
    </div>
  </div>;
}
