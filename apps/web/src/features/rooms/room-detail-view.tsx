"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { BalanceSummary } from "@/components/balance-summary";
import { DataStatePanel } from "@/components/data-state-panel";
import { RoomSwitcher } from "@/components/room-switcher";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { MatchList } from "@/features/matchday/match-list";
import { RoomF1Arena } from "@/features/f1/room-f1-arena";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import { buildInvitePath, normalizeRoomDetail, type RoomBalanceRecord, type RoomMemberRecord, type RoomSummaryRecord } from "./room-flow";
import { RoomChatView } from "./room-chat-view";

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

  // Pure read: returns data and touches no state, so every setState below stays
  // in a promise callback where React can see it.
  const loadRoom = useCallback(async (signal: AbortSignal) => {
    const [rooms, room, balance, members] = await Promise.all([
      request<RoomSummaryRecord[]>("/api/v1/rooms", signal),
      request<RoomSummaryRecord>(`/api/v1/rooms/${encodeURIComponent(roomId)}`, signal),
      request<RoomBalanceRecord>(`/api/v1/rooms/${encodeURIComponent(roomId)}/balance`, signal),
      request<RoomMemberRecord[]>(`/api/v1/rooms/${encodeURIComponent(roomId)}/members`, signal),
    ]);
    return { rooms, detail: normalizeRoomDetail({ room, balance, members }) };
  }, [roomId]);

  // One round at a time: opening a round abandons the previous one, so a slow
  // early response can never land on top of a newer one.
  const inFlight = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    return loadRoom(signal)
      .then((data) => { if (signal.aborted) return; setRooms(data.rooms); setDetail(data.detail); setError(""); })
      .catch((reason) => { if (!signal.aborted && (reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载房间"); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
  }, [loadRoom]);

  useEffect(() => { void refresh(); return () => inFlight.current?.abort(); }, [refresh]);

  // Settlement happens in the worker. Polling turns that server-side close into an
  // immediate in-room explanation rather than leaving a stale, still-clickable slip
  // — but only while the room is on screen. Four requests every 30 seconds was the
  // app's heaviest loop, and a backgrounded room had nobody reading the answer.
  useVisibleInterval(() => { void refresh(); }, 30_000);

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
      本轮全部竞猜均已结算；可由房主开启下一轮。个人结果、赔率与盈亏请到「我的战绩」查询。
    </StatusMessage>}
    {detail.status === "RESTRICTED" && <StatusMessage tone="info" title="房间已限制">
      当前不能提交新竞猜；已有记录和结算结果仍可查看。
    </StatusMessage>}
    <section className="surface overflow-hidden">
      <div className="pulse-room-bar">
        <div className="min-w-0">
          <p className="pulse-room-bar__kind">{detail.sport === "FORMULA_1" ? "FORMULA 1" : "FOOTBALL"} / {detail.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE"}</p>
          <h2 className="pulse-room-bar__name">{detail.name}</h2>
          <p className="pulse-room-bar__facts">{detail.status === "ACTIVE" ? "开放中" : detail.status === "RESTRICTED" ? "已封盘" : "已结算"} · {detail.memberCount} 位成员{detail.tier === "ADVANCED" && detail.sport !== "FORMULA_1" ? " · 高级（可买比分）" : ""}</p>
        </div>
        <RoomSwitcher rooms={rooms} currentRoomId={roomId}/>
      </div>
      <BalanceSummary balance={detail.balance}/>
    </section>

    {/* 去掉左侧 4px 红边：这块本来就有红色 eyebrow 领头，再加一条侧边色条是重复强调。 */}
    <section className="surface p-5" aria-labelledby="round-explainer-title">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">GROUP &amp; ROUND LIFECYCLE</p><h2 id="round-explainer-title" className="display mt-1 text-2xl font-bold">长期群组 · 一次性赛事轮次</h2></div><span className="league-pill">{detail.status === "ACTIVE" ? "正在接受竞猜" : detail.status === "RESTRICTED" ? "等待官方结果" : "等待下一轮"}</span></div>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-[var(--muted)] sm:grid-cols-2">
        <p><b className="text-[var(--ink)]">提交前：</b>每个盘口只可下注一次；显示的赔率与确认时的快照绑定。</p>
        <p><b className="text-[var(--ink)]">开赛时：</b>对应比赛或 F1 场次自动封盘，之后不会接受新提交或冻结积分。</p>
        <p><b className="text-[var(--ink)]">结算时：</b>仅以官方确认赛果结算；赛中排名、传闻或临时比分不会提前结算。</p>
        <p><b className="text-[var(--ink)]">结算后：</b>当本轮全部已提交竞猜结算完成，下一场赛事可以开启新轮次；个人战绩保留在「我的战绩」。</p>
      </div>
    </section>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="members-title" className="surface p-5"><div className="flex items-center justify-between gap-4"><h2 id="members-title" className="display text-2xl font-bold">房间成员</h2>{detail.isOwner && <Link href={`/rooms/${encodeURIComponent(roomId)}/status`} className="text-sm font-bold underline">查看提交状态</Link>}</div><ul className="mt-4 divide-y divide-[var(--line)]">{detail.members.map((member) => <li key={member.userId} className="flex min-h-14 items-center justify-between gap-4 py-3"><span className="flex min-w-0 items-center gap-3"><Avatar src={member.avatarUrl} version={member.avatarVersion} nickname={member.displayName} size={40}/><span className="truncate font-bold">{member.displayName}</span></span><span className="text-xs text-[var(--muted)]">{member.roleLabel}</span></li>)}</ul></section>
      {detail.status !== "ACTIVE" ? <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">本轮已结束</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">群组会保留；待全部结算完成后即可开启下一场赛事。个人战绩可在「我的战绩」查询。</p></aside> : detail.visibility === "PUBLIC" ? <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">公开群组</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">此群组会显示在公开大厅，任何已登录用户确认本轮规则后都可以加入，无需邀请链接。</p></aside> : detail.isOwner ? <aside className="surface h-fit p-5" aria-labelledby="invite-title"><h2 id="invite-title" className="display text-xl font-bold">邀请朋友</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">请先确认参与者理解：赛事开始会自动封盘；所有已提交竞猜结算后，群组才可进入下一轮。生成新链接会让旧链接立即失效，不影响现有成员和积分。</p>{inviteError && <div className="mt-4"><StatusMessage tone="error" title="邀请操作失败">{inviteError}</StatusMessage></div>}{inviteToken ? <div className="mt-4"><StatusMessage tone="success" title="新邀请已生成">请只发送给你认识的人。</StatusMessage><label htmlFor="room-invite-url" className="mt-4 block text-xs font-bold">邀请链接</label><input id="room-invite-url" readOnly value={inviteUrl} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm"/><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setInviteError("浏览器无法自动复制，请手动选择上方链接。"); } }} className="mt-3 min-h-11 w-full rounded-full border-2 border-[var(--ink)] px-3 font-bold transition hover:bg-[var(--ink)] hover:text-white">{copied ? "已复制" : "复制邀请链接"}</button></div> : <button type="button" onClick={resetInvite} disabled={resetting} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--field)] px-3 font-bold text-white transition hover:brightness-95 disabled:opacity-55">{resetting ? "正在生成…" : "生成新的邀请链接"}</button>}</aside> : <aside className="surface h-fit p-5"><h2 className="display text-xl font-bold">成员权限</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">赛事开始后自动封盘。你可以查看自己的个人战绩；下一轮须等当前轮次全部结算。</p></aside>}
    </div>

    {/* Room public chat (Story 12.3): member-only, plain text, polled while visible. */}
    <RoomChatView roomId={roomId} members={detail.members.map((member) => ({ userId: member.userId, username: member.username, isOwner: member.role === "room_owner" }))}/>

    <section className="surface p-5" aria-labelledby="room-rules-title">
      <h2 id="room-rules-title" className="display text-xl font-bold">本房间规则</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
        <li>一个房间是长期竞猜群组：同一时间只允许一场比赛或一个 F1 场次作为当前轮次；全部结算后才能进入下一轮。</li>
        <li>每个盘口只能提交一次判断；开赛即封盘，服务端以实际比赛状态和最终赔率快照为准。</li>
        <li>积分仅为虚拟积分，不可充值、转让、提现或兑换；单张投入上限为 20,000 分。</li>
        <li>{detail.sport === "FORMULA_1" ? "F1 成绩由自动同步的公开赛果确认后结算；赛中不会按临时排名结算。" : "足球赛果确认后自动结算；如发生官方更正，账本会追加冲正和重新结算记录。"}</li>
      </ul>
      <Link href="/terms" className="mt-4 inline-block text-sm font-bold underline">查看完整使用规则</Link>
    </section>

    <section className="surface p-5" aria-labelledby="personal-history-title"><h2 id="personal-history-title" className="display text-xl font-bold">个人历史与结算凭证</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">轮次结束后不在群组内堆叠旧竞猜记录。每位成员可在个人战绩中查询自己的投注、赔率快照、结算版本与盈亏。</p><Link href="/history" className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">查看我的战绩</Link></section>
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
