"use client";

import Link from "next/link";
import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { TeamCrest } from "@/components/football";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { buildInvitePath, createRoomRequest, publicRoomJoinRequest, ROOM_SPORT_LABELS, type PublicRoomSummaryRecord, type RoomSport, type RoomSummaryRecord, type RoomTier, type RoomVisibility } from "./room-flow";

type CreatedRoom = RoomSummaryRecord & { inviteToken?: string };

export function RoomListView() {
  const router = useRouter();
  const nameId = useId();
  const rulesId = useId();
  const [rooms, setRooms] = useState<RoomSummaryRecord[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<CreatedRoom>();
  const [copied, setCopied] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState("");
  const [joinError, setJoinError] = useState("");
  const [sportChoice, setSportChoice] = useState<RoomSport>("FOOTBALL");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [mineResponse, publicResponse] = await Promise.all([
          fetch("/api/v1/rooms", { credentials: "same-origin", signal: controller.signal }),
          fetch("/api/v1/rooms/public", { credentials: "same-origin", signal: controller.signal }),
        ]);
        const mine = await mineResponse.json().catch(() => ({})) as ApiEnvelope<RoomSummaryRecord[]> & ApiFailure;
        const lobby = await publicResponse.json().catch(() => ({})) as ApiEnvelope<PublicRoomSummaryRecord[]> & ApiFailure;
        if (!mineResponse.ok) throw new Error(mine.error?.message || "无法加载房间");
        if (!publicResponse.ok) throw new Error(lobby.error?.message || "无法加载公开大厅");
        setRooms(Array.isArray(mine.data) ? mine.data : []);
        setPublicRooms(Array.isArray(lobby.data) ? lobby.data : []);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setLoadError((reason as Error).message || "无法加载房间");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setCreating(true);
    setCreateError("");
    setCreated(undefined);
    setCopied(false);
    const form = new FormData(formElement);
    const visibility = String(form.get("visibility") || "PRIVATE") as RoomVisibility;
    const tier = String(form.get("tier") || "STANDARD") as RoomTier;
    const sport = String(form.get("sport") || "FOOTBALL") as RoomSport;
    const request = createRoomRequest(String(form.get("name") || ""), visibility, tier, sport);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<CreatedRoom> & ApiFailure;
      if (!response.ok) throw new Error(roomError(result.error?.code, result.error?.message));
      setCreated(result.data);
      setRooms((current) => [result.data, ...current.filter((room) => room.id !== result.data.id)]);
      formElement.reset();
    } catch (reason) {
      setCreateError((reason as Error).message || "暂时无法创建房间");
    } finally {
      setCreating(false);
    }
  }

  async function joinPublic(roomId: string) {
    if (!window.confirm("加入前请确认：积分不可购买、转让或兑换。确认加入这个公开房间吗？")) return;
    setJoiningRoomId(roomId); setJoinError("");
    const request = publicRoomJoinRequest(roomId);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ roomId: string }> & ApiFailure;
      if (!response.ok) throw new Error(roomError(result.error?.code, result.error?.message));
      router.push(`/rooms/${encodeURIComponent(result.data.roomId)}`);
    } catch (reason) {
      setJoinError((reason as Error).message || "暂时无法加入公开房间");
    } finally {
      setJoiningRoomId("");
    }
  }

  const invitePath = created?.inviteToken ? buildInvitePath(created.inviteToken) : "";
  const inviteUrl = invitePath && typeof window !== "undefined" ? `${window.location.origin}${invitePath}` : invitePath;

  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.72fr)]">
    <div className="space-y-10">
    <section aria-labelledby="public-rooms-title">
      <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">公开大厅</p><h2 id="public-rooms-title" className="kinetic mt-1 text-3xl">发现公开房间</h2></div><span className="league-pill shrink-0">{publicRooms.length} 个</span></div>
      {joinError && <div className="mb-4"><StatusMessage tone="error" title="未能加入">{joinError}</StatusMessage></div>}
      {loading ? <DataStatePanel state="loading" title="正在加载公开大厅" description=""/> : publicRooms.length ? <ul className="grid gap-4 sm:grid-cols-2">{publicRooms.map((room) => <li key={room.id} className="surface rounded-xl p-5"><div className="flex items-start justify-between gap-3"><TeamCrest name={room.name} className="size-12 text-base"/><span className="league-pill">{ROOM_SPORT_LABELS[room.sport ?? "FOOTBALL"]} · 公开</span></div><strong className="mt-4 block text-lg font-black">{room.name}</strong><p className="mt-1 text-xs text-[var(--muted)]">房主 {room.ownerName} · {room.memberCount} 人</p>{room.joined ? <Link href={`/rooms/${encodeURIComponent(room.id)}`} className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white no-underline">进入房间</Link> : <button type="button" disabled={joiningRoomId === room.id} onClick={() => joinPublic(room.id)} className="mt-4 min-h-10 w-full rounded-full bg-[var(--ink)] px-4 text-sm font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-55">{joiningRoomId === room.id ? "正在加入…" : "确认规则并加入"}</button>}</li>)}</ul> : <DataStatePanel state="empty" title="还没有公开房间" description="创建第一个公开房间，其他注册用户就能在这里加入。"/>}
    </section>
    <section aria-labelledby="my-rooms-title">
      <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">我的房间</p><h2 id="my-rooms-title" className="kinetic mt-1 text-3xl">我的房间</h2></div><span className="league-pill shrink-0">{rooms.length} 个</span></div>
      {loading ? <DataStatePanel state="loading" title="正在加载房间" description=""/> : loadError ? <DataStatePanel state="error" title="房间加载失败" description={loadError} action={<button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">重新加载</button>}/> : rooms.length ? <ul className="grid gap-4 sm:grid-cols-2">{rooms.map((room) => <li key={room.id}><Link href={`/rooms/${encodeURIComponent(room.id)}`} className="group surface relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl p-5 no-underline transition duration-200 hover:-translate-y-1 hover:border-[var(--field)] hover:shadow-[0_16px_40px_rgb(15_80_57/16%)]"><div className="flex items-start justify-between gap-3"><TeamCrest name={room.name} className="size-12 text-base"/><span className="league-pill shrink-0">{ROOM_SPORT_LABELS[room.sport ?? "FOOTBALL"]} · {room.visibility === "PUBLIC" ? "公开" : "私人"}{room.tier === "ADVANCED" ? " · 高级" : ""} · {room.role === "room_owner" ? "房主" : "成员"}</span></div><div className="mt-4"><strong className="block text-lg font-black leading-tight">{room.name}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{room.memberCount === undefined ? "独立积分" : `${room.memberCount} 人 · 独立 10,000 积分`}</span></div><span aria-hidden="true" className="link-arrow pointer-events-none absolute bottom-5 right-5 text-xl text-[var(--field)] opacity-0 transition group-hover:opacity-100">→</span></Link></li>)}</ul> : <DataStatePanel state="empty" title="还没有房间" description="创建公开或私人房间，也可以从公开大厅加入。"/>}
    </section>
    </div>

    <aside className="surface h-fit rounded-xl p-5 sm:p-6" aria-labelledby="create-room-title">
      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">开始你的赛事</p><h2 id="create-room-title" className="kinetic mt-1 text-2xl">创建房间</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">公开房间会出现在大厅；私人房间仅通过邀请链接加入。</p>
      {createError && <div className="mt-4"><StatusMessage tone="error" title="未能创建">{createError}</StatusMessage></div>}
      {created && <div className="mt-4"><StatusMessage tone="success" title="房间已创建">{created.visibility === "PUBLIC" ? "公开房间已进入大厅，所有注册用户都能申请加入。" : "邀请链接只展示在当前结果中；离开后可在房间内重置生成新链接。"}</StatusMessage>{created.inviteToken && <><label className="mt-4 block text-xs font-bold" htmlFor={`${nameId}-invite`}>邀请链接</label><input id={`${nameId}-invite`} readOnly value={inviteUrl} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm"/></>}<div className="mt-3 grid gap-2 sm:grid-cols-2">{created.inviteToken && <button type="button" onClick={async () => { try { await copyInvite(inviteUrl); setCopied(true); } catch { setCreateError("浏览器无法自动复制，请手动选择上方链接。"); } }} className="min-h-11 rounded-full border-2 border-[var(--ink)] px-3 font-bold transition hover:bg-[var(--ink)] hover:text-white">{copied ? "已复制" : "复制邀请"}</button>}<button type="button" onClick={() => router.push(`/rooms/${encodeURIComponent(created.id)}`)} className="min-h-11 rounded-full bg-[var(--field)] px-3 font-bold text-white transition hover:brightness-95">进入房间</button></div></div>}
      <form onSubmit={createRoom} className="mt-5 space-y-4">
        <fieldset><legend className="mb-2 text-sm font-bold">竞猜赛事</legend><div className="grid grid-cols-2 gap-2"><label className={`cursor-pointer rounded-xl border p-3 text-sm ${sportChoice === "FOOTBALL" ? "border-[var(--field)] bg-[rgb(15_80_57/6%)]" : "border-[var(--line)]"}`}><input name="sport" type="radio" value="FOOTBALL" checked={sportChoice === "FOOTBALL"} onChange={() => setSportChoice("FOOTBALL")} className="mr-2 accent-[var(--field)]"/><strong>足球</strong><span className="mt-1 block text-xs text-[var(--muted)]">联赛与杯赛比赛</span></label><label className={`cursor-pointer rounded-xl border p-3 text-sm ${sportChoice === "FORMULA_1" ? "border-[var(--field)] bg-[rgb(15_80_57/6%)]" : "border-[var(--line)]"}`}><input name="sport" type="radio" value="FORMULA_1" checked={sportChoice === "FORMULA_1"} onChange={() => setSportChoice("FORMULA_1")} className="mr-2 accent-[var(--field)]"/><strong>F1 赛车</strong><span className="mt-1 block text-xs text-[var(--muted)]">Race Weekend 场次</span></label></div><p className="mt-2 text-xs leading-5 text-[var(--muted)]">每个房间只围绕一种赛事竞猜，创建后不可更改。</p></fieldset>
        <div><label htmlFor={nameId} className="mb-2 block text-sm font-bold">房间名称</label><input id={nameId} name="name" required minLength={2} maxLength={80} placeholder={sportChoice === "FORMULA_1" ? "例如：正赛冲刺围场局" : "例如：周末看球局"} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3"/></div>
        <fieldset><legend className="mb-2 text-sm font-bold">房间类型</legend><div className="grid grid-cols-2 gap-2"><label className="cursor-pointer rounded-xl border border-[var(--line)] p-3 text-sm"><input name="visibility" type="radio" value="PRIVATE" defaultChecked className="mr-2 accent-[var(--field)]"/><strong>私人</strong><span className="mt-1 block text-xs text-[var(--muted)]">仅邀请加入</span></label><label className="cursor-pointer rounded-xl border border-[var(--line)] p-3 text-sm"><input name="visibility" type="radio" value="PUBLIC" className="mr-2 accent-[var(--field)]"/><strong>公开</strong><span className="mt-1 block text-xs text-[var(--muted)]">大厅可见</span></label></div></fieldset>
        <fieldset><legend className="mb-2 text-sm font-bold">玩法档位</legend><div className="grid grid-cols-2 gap-2"><label className="cursor-pointer rounded-xl border border-[var(--line)] p-3 text-sm"><input name="tier" type="radio" value="STANDARD" defaultChecked className="mr-2 accent-[var(--field)]"/><strong>标准</strong><span className="mt-1 block text-xs text-[var(--muted)]">{sportChoice === "FORMULA_1" ? "冠军 / 领奖台 / 对决" : "仅胜平负"}</span></label><label className="cursor-pointer rounded-xl border border-[var(--line)] p-3 text-sm"><input name="tier" type="radio" value="ADVANCED" className="mr-2 accent-[var(--field)]"/><strong>高级</strong><span className="mt-1 block text-xs text-[var(--muted)]">{sportChoice === "FORMULA_1" ? "再开放精确前三" : "胜平负 + 买比分"}</span></label></div></fieldset>
        <label htmlFor={rulesId} className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input id={rulesId} name="rulesAccepted" type="checkbox" required className="mt-1 size-5 shrink-0 accent-[var(--field)]"/><span>我确认当前房间规则，并理解积分不可购买、转让或兑换。 <Link href="/terms" className="font-bold underline">查看规则</Link></span></label>
        <button disabled={creating} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ink)] px-4 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-55">{creating ? "正在创建…" : "创建房间"}</button>
      </form>
    </aside>
  </div>;
}

async function copyInvite(value: string) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function roomError(code?: string, fallback?: string) {
  if (code === "ROOM_RULES_REQUIRED") return "请确认当前私人房间规则。";
  if (code === "INVALID_ROOM_NAME") return "房间名称需要 2–80 个字符。";
  if (code === "UNAUTHENTICATED") return "登录状态已失效，请重新登录。";
  return fallback || "暂时无法创建房间，请稍后重试。";
}
