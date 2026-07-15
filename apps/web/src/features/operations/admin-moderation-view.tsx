"use client";

import { useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { moderationActionRequest, moderationReauthRequest, preMatchVisibilityRequest } from "./admin-moderation";

type Report = { reportId: string; roomId: string; roomName: string; roomStatus: string; reporter: string; reason: string; status: string; createdAt: string };
type Audit = { id: string; actor: string | null; action: string; targetType: string; targetId: string; occurredAt: string };
type Room = { roomId: string; name: string; status: string; memberCount: number; preMatchStakeVisible: boolean; postMatchTicketVisible: boolean };

export function AdminModerationView() {
  const [reports, setReports] = useState<Report[]>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState("");
  const [busyRoom, setBusyRoom] = useState("");

  const load = useCallback(async () => {
    try {
      const [reportsResponse, auditResponse, roomsResponse] = await Promise.all([
        fetch("/api/v1/admin/reports", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/v1/admin/audit", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/v1/admin/rooms", { credentials: "same-origin", cache: "no-store" }),
      ]);
      const reportsBody = await reportsResponse.json() as ApiEnvelope<Report[]> & ApiFailure;
      const auditBody = await auditResponse.json() as ApiEnvelope<Audit[]> & ApiFailure;
      const roomsBody = await roomsResponse.json() as ApiEnvelope<Room[]> & ApiFailure;
      if (!reportsResponse.ok || !auditResponse.ok || !roomsResponse.ok) throw new Error(reportsBody.error?.message || auditBody.error?.message || roomsBody.error?.message || "无法加载治理数据");
      setReports(reportsBody.data); setAudit(auditBody.data); setRooms(roomsBody.data);
    } catch (reason) { setError((reason as Error).message || "无法加载治理数据"); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function reauthenticate() {
    const password = window.prompt("敏感操作：请输入当前超级管理员密码（验证有效期 5 分钟）");
    if (!password) return false;
    const request = moderationReauthRequest(password);
    const response = await fetch(request.url, request.init);
    const body = await response.json().catch(() => ({})) as ApiFailure;
    if (!response.ok) throw new Error(body.error?.message || "管理员密码验证失败");
    return true;
  }

  async function moderate(roomId: string, action: "RESTRICT" | "CLOSE" | "RESTORE") {
    const reason = window.prompt("请输入本次处理原因（至少 5 字）"); if (!reason) return;
    setBusyRoom(roomId); setError("");
    try {
      if (!await reauthenticate()) return;
      const operation = moderationActionRequest(roomId, action, reason);
      const response = await fetch(operation.url, operation.init);
      const body = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(body.error?.message || "处理失败");
      await load();
    } catch (reason) { setError((reason as Error).message || "处理失败"); }
    finally { setBusyRoom(""); }
  }

  async function updatePreMatchVisibility(room: Room, visible: boolean) {
    setBusyRoom(room.roomId); setError("");
    try {
      if (!await reauthenticate()) return;
      const operation = preMatchVisibilityRequest(room.roomId, visible);
      const response = await fetch(operation.url, operation.init);
      const body = await response.json().catch(() => ({})) as ApiEnvelope<Room> & ApiFailure;
      if (!response.ok) throw new Error(body.error?.message || "可见性保存失败");
      setRooms((current) => current.map((item) => item.roomId === room.roomId ? { ...item, preMatchStakeVisible: visible } : item));
    } catch (reason) { setError((reason as Error).message || "可见性保存失败"); }
    finally { setBusyRoom(""); }
  }

  if (!reports && !error) return <DataStatePanel state="loading" title="正在加载举报和审计" description=""/>;
  if (!reports) return <DataStatePanel state="error" title="治理数据暂不可用" description={error}/>;

  return <div className="space-y-6">
    {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}
    <section className="surface p-5"><h2 className="display text-2xl font-bold">房间记录可见性</h2><p className="mt-2 text-sm text-[var(--muted)]">平台超级管理员决定未开赛时是否公开其他成员的投入积分。默认关闭，选择和倍率始终等到开赛后再按房主设置处理。</p>{rooms.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">暂无房间。</p> : <ul className="mt-4 space-y-3">{rooms.map((room) => <li key={room.roomId} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] p-4"><div><strong>{room.name}</strong><p className="mt-1 text-xs text-[var(--muted)]">{room.status} · {room.memberCount} 位成员 · 开赛后完整记录{room.postMatchTicketVisible ? "公开" : "隐藏"}</p></div><label className="flex cursor-pointer items-center gap-2 text-sm font-bold"><input type="checkbox" checked={room.preMatchStakeVisible} disabled={busyRoom === room.roomId} onChange={(event) => void updatePreMatchVisibility(room, event.target.checked)} className="size-5 accent-[var(--field)]"/>未开赛公开投入积分</label></li>)}</ul>}</section>
    <section className="surface p-5"><h2 className="display text-2xl font-bold">房间举报</h2>{reports.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">暂无举报。</p> : <ul className="mt-4 space-y-4">{reports.map((report) => <li key={report.reportId} className="rounded-xl border border-[var(--line)] p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{report.roomName}</strong><span className="text-xs">{report.status} · {report.roomStatus}</span></div><p className="mt-2 text-sm">{report.reason}</p><p className="mt-1 text-xs text-[var(--muted)]">举报人：{report.reporter} · {new Date(report.createdAt).toLocaleString("zh-CN")}</p><div className="mt-3 flex flex-wrap gap-2">{(["RESTRICT", "CLOSE", "RESTORE"] as const).map((action) => <button key={action} disabled={busyRoom === report.roomId} onClick={() => void moderate(report.roomId, action)} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-xs font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-50">{action === "RESTRICT" ? "限制预测" : action === "CLOSE" ? "关闭房间" : "恢复房间"}</button>)}</div></li>)}</ul>}</section>
    <section className="surface p-5"><h2 className="display text-2xl font-bold">最近审计</h2><ul className="mt-4 divide-y divide-[var(--line)]">{audit.slice(0, 50).map((item) => <li key={item.id} className="py-3 text-sm"><strong>{item.action}</strong> · {item.targetType}:{item.targetId}<span className="ml-2 text-xs text-[var(--muted)]">{item.actor ?? "系统"} · {new Date(item.occurredAt).toLocaleString("zh-CN")}</span></li>)}</ul></section>
  </div>;
}
