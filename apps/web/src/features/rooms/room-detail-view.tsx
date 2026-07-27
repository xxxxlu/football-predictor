"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BalanceSummary } from "@/components/balance-summary";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomSwitcher } from "@/components/room-switcher";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { MatchList } from "@/features/matchday/match-list";
import { RoomF1Arena } from "@/features/f1/room-f1-arena";
import { buildInvitePath, normalizeRoomDetail, type RoomBalanceRecord, type RoomMemberRecord, type RoomSummaryRecord } from "./room-flow";
import { RoomTicketHistoryView } from "./room-ticket-history-view";

type Detail = ReturnType<typeof normalizeRoomDetail>;

export function RoomDetailView({ roomId }: { roomId: string }) {
  const [rooms, setRooms] = useState<RoomSummaryRecord[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportMessage, setReportMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const controllers = new Set<AbortController>();
    const load = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const [roomsResult, roomResult, balanceResult, membersResult] = await Promise.all([
          request<RoomSummaryRecord[]>("/api/v1/rooms", controller.signal),
          request<RoomSummaryRecord>(`/api/v1/rooms/${encodeURIComponent(roomId)}`, controller.signal),
          request<RoomBalanceRecord>(`/api/v1/rooms/${encodeURIComponent(roomId)}/balance`, controller.signal),
          request<RoomMemberRecord[]>(`/api/v1/rooms/${encodeURIComponent(roomId)}/members`, controller.signal),
        ]);
        if (disposed) return;
        setRooms(roomsResult);
        setDetail(normalizeRoomDetail({ room: roomResult, balance: balanceResult, members: membersResult }));
        setError("");
      } catch (reason) {
        if (!disposed && (reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载房间");
      } finally {
        controllers.delete(controller);
        if (!disposed) setLoading(false);
      }
    };
    void load();
    // Settlement happens in the worker. Polling turns that server-side close into an
    // immediate in-room explanation rather than leaving a stale, still-clickable slip.
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { disposed = true; window.clearInterval(interval); for (const controller of controllers) controller.abort(); };
  }, [roomId]);

  async function resetInvite() {
    setResetting(true); setInviteError(""); setInviteToken(""); setCopied(false);
    try {
      const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/invite/reset`, { method: "POST", credentials: "same-origin" });
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ inviteToken: string }> & ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || "无法生成邀请");
      setInviteToken(result.data.inviteToken);
    } catch (reason) {
      setInviteError((reason as Error).message || "无法生成邀请");
    } finally {
      setResetting(false);
    }
  }

  async function reportRoom() {
    const reason = window.prompt("请说明举报原因（10–500 字）。举报将提交给超级管理员。");
    if (!reason) return; setReporting(true); setReportMessage("");
    try { const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/reports`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); const result = await response.json().catch(() => ({})) as ApiFailure; if (!response.ok) throw new Error(result.error?.message || "举报提交失败"); setReportMessage("举报已提交，超级管理员会进行处理。"); }
    catch (reason) { setReportMessage((reason as Error).message || "举报提交失败"); } finally { setReporting(false); }
  }

  if (loading) return <DataStatePanel state="loading" title="正在加载房间" description=""/>;
  if (error || !detail) return <DataStatePanel state="error" title="房间暂不可用" description={error || "找不到这个房间，或你已不再是成员。"} action={<Link href="/rooms" className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold no-underline transition hover:bg-[var(--ink)] hover:text-white">返回我的房间</Link>}/>;
  const invitePath = inviteToken ? buildInvitePath(inviteToken) : "";
  const inviteUrl = invitePath && typeof window !== "undefined" ? `${window.location.origin}${invitePath}` : invitePath;

  return <div className="space-y-6">
    {detail.status === "CLOSED" && <StatusMessage tone="success" title="本轮房间已结算并结束">
      所有已提交判断均已结算；房间已从「我的房间」和公开大厅移除，不能再加入或提交新竞猜。结算记录和账本仍会保留在本页，便于复盘与赛果更正。
    </StatusMessage>}
    {detail.status === "RESTRICTED" && <StatusMessage tone="info" title="房间已限制">
      当前不能提交新竞猜；已有记录和结算结果仍可查看。
    </StatusMessage>}
    <section className="surface overflow-hidden"><div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><RoomSwitcher rooms={rooms} currentRoomId={roomId}/><div className="text-left sm:text-right"><p className="text-xs text-[var(--muted)]">房间状态</p><p className="mt-1 text-sm font-bold">{detail.sport === "FORMULA_1" ? "F1 赛车" : "足球"} · {detail.visibility === "PUBLIC" ? "公开" : "私人"}{detail.tier === "ADVANCED" && detail.sport !== "FORMULA_1" ? " · 高级（可买比分）" : ""} · {detail.status === "ACTIVE" ? "正常" : detail.status === "RESTRICTED" ? "已限制" : "已关闭"} · {detail.memberCount} 位成员</p></div></div><BalanceSummary balance={detail.balance}/></section>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="members-title" className="surface p-5"><div className="flex items-center justify-between gap-4"><h2 id="members-title" className="display text-2xl font-bold">房间成员</h2>{detail.isOwner && <Link href={`/rooms/${encodeURIComponent(roomId)}/status`} className="text-sm font-bold underline">查看提交状态</Link>}</div><ul className="mt-4 divide-y divide-[var(--line)]">{detail.members.map((member) => <li key={member.userId} className="flex min-h-14 items-center justify-between gap-4 py-3"><span className="font-bold">{member.displayName}</span><span className="text-xs text-[var(--muted)]">{member.roleLabel}</span></li>)}</ul></section>
      {detail.status !== "ACTIVE" ? <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">房间已结束</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">结算完成后房间会自动关闭并从常规列表移除；历史记录保留，仅供本房间成员复盘。</p></aside> : detail.visibility === "PUBLIC" ? <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">公开房间</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">此房间会显示在公开大厅，任何已登录用户确认规则后都可以加入，无需邀请链接。</p></aside> : detail.isOwner ? <aside className="surface h-fit p-5" aria-labelledby="invite-title"><h2 id="invite-title" className="display text-xl font-bold">邀请朋友</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">出于安全原因，已有邀请不会再次显示。生成新链接会让旧链接立即失效，不影响现有成员和积分。</p>{inviteError && <div className="mt-4"><StatusMessage tone="error" title="邀请操作失败">{inviteError}</StatusMessage></div>}{inviteToken ? <div className="mt-4"><StatusMessage tone="success" title="新邀请已生成">请只发送给你认识的人。</StatusMessage><label htmlFor="room-invite-url" className="mt-4 block text-xs font-bold">邀请链接</label><input id="room-invite-url" readOnly value={inviteUrl} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm"/><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setInviteError("浏览器无法自动复制，请手动选择上方链接。"); } }} className="mt-3 min-h-11 w-full rounded-full border-2 border-[var(--ink)] px-3 font-bold transition hover:bg-[var(--ink)] hover:text-white">{copied ? "已复制" : "复制邀请链接"}</button></div> : <button type="button" onClick={resetInvite} disabled={resetting} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--field)] px-3 font-bold text-white transition hover:brightness-95 disabled:opacity-55">{resetting ? "正在生成…" : "生成新的邀请链接"}</button>}</aside> : <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">成员权限</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">只有房主可以重置邀请。你仍可以查看成员、比赛、预测历史和当前房间账本。</p></aside>}
    </div>

    <section className="surface p-5" aria-labelledby="room-rules-title">
      <h2 id="room-rules-title" className="display text-xl font-bold">本房间规则</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
        <li>一个房间是一轮独立竞猜：全部已提交判断结算后自动结束并从常规列表移除，不能继续竞猜或加入。</li>
        <li>每个盘口只能提交一次判断；开赛即封盘，服务端以实际比赛状态和最终赔率快照为准。</li>
        <li>积分仅为虚拟积分，不可充值、转让、提现或兑换；单张投入上限为 20,000 分。</li>
        <li>{detail.sport === "FORMULA_1" ? "F1 成绩由自动同步的公开赛果确认后结算；赛中不会按临时排名结算。" : "足球赛果确认后自动结算；如发生官方更正，账本会追加冲正和重新结算记录。"}</li>
      </ul>
      <Link href="/terms" className="mt-4 inline-block text-sm font-bold underline">查看完整使用规则</Link>
    </section>

    <RoomTicketHistoryView roomId={roomId} isOwner={detail.isOwner} initialPostMatchTicketVisible={detail.postMatchTicketVisible}/>
    {/* A room predicts exactly one sport — only that sport's contest section renders. */}
    {detail.sport === "FORMULA_1"
      ? <section aria-labelledby="room-f1-title" className="surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="room-f1-title" className="display text-2xl font-bold">本房间 F1 竞赛</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">最近一场的竞猜直接在这里提交：正赛猜冠军和领奖台之争（按顺序选出前三），排位赛猜杆位；每个盘口只能压一注。</p>
            </div>
            <button type="button" onClick={reportRoom} disabled={reporting} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--coral)] px-4 text-sm font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-50">{reporting ? "正在提交…" : "举报此房间"}</button>
          </div>
          {reportMessage && <div className="mb-4"><StatusMessage tone={reportMessage.includes("已提交") ? "success" : "error"} title={reportMessage}/></div>}
          <RoomF1Arena roomId={roomId} interactive={detail.status === "ACTIVE"} />
        </section>
      : <section aria-labelledby="room-matches-title"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="room-matches-title" className="display text-2xl font-bold">本房间比赛</h2><button type="button" onClick={reportRoom} disabled={reporting} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--coral)] px-4 text-sm font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-50">{reporting ? "正在提交…" : "举报此房间"}</button></div>{reportMessage && <div className="mb-4"><StatusMessage tone={reportMessage.includes("已提交") ? "success" : "error"} title={reportMessage}/></div>}<MatchList roomId={roomId} interactive={detail.status === "ACTIVE"} advanced={detail.tier === "ADVANCED"}/></section>}
  </div>;
}

async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  const result = await response.json().catch(() => ({})) as ApiEnvelope<T> & ApiFailure;
  if (!response.ok) throw new Error(result.error?.message || "无法加载房间数据");
  return result.data;
}
