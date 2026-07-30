"use client";

import { FormEvent, useEffect, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { moderationActionRequest, moderationReauthRequest, preMatchVisibilityRequest } from "./admin-moderation";
import { AdminGovernanceView, GovernanceConfirmPanel } from "./admin-governance-view";
import { governanceActionLabel } from "./admin-governance-flow";

/**
 * Room governance beyond the report queue (FR56, FR60).
 *
 * The inbox above is where reported rooms and messages are handled. This screen
 * keeps the two things that are not driven by a report: the room list — where a
 * room can be restricted, closed or restored on an operator's own initiative, and
 * where pre-match stake visibility is set — and the platform-wide audit trail.
 *
 * Each section loads on its own and simply disappears when the server refuses it.
 * A community moderator holds neither the room governance duty nor AUDIT_READ, so
 * for them this page is the inbox alone instead of a page-wide error.
 */
type Audit = { id: string; actor: string | null; action: string; targetType: string; targetId: string; occurredAt: string };
type Room = { roomId: string; name: string; status: string; memberCount: number; preMatchStakeVisible: boolean; postMatchTicketVisible: boolean };
type RoomAction = "RESTRICT" | "CLOSE" | "RESTORE";
type Pending =
  | { kind: "MODERATE"; room: Room; action: RoomAction }
  | { kind: "VISIBILITY"; room: Room; visible: boolean };

const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const ACTION_LABELS: Record<RoomAction, string> = { RESTRICT: "限制预测", CLOSE: "关闭房间", RESTORE: "恢复房间" };
const ACTION_NOTES: Record<RoomAction, string> = {
  RESTRICT: "房间将停止接受新的预测，成员仍可查看已有记录。积分、票据与结算不受影响。",
  CLOSE: "房间将被关闭，不再接受预测。已有战绩、票据与账本记录全部保留，不做删除。",
  RESTORE: "房间恢复为正常状态，成员可以继续预测。",
};

export function AdminModerationView() {
  const [rooms, setRooms] = useState<Room[]>();
  const [audit, setAudit] = useState<Audit[]>();
  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    // Refused sections stay undefined and render nothing: this page is not the
    // security boundary, and a missing duty is not an error worth shouting about.
    void loadSection<{ data: Room[] }>("/api/v1/admin/rooms").then((body) => { if (active) setRooms(body?.data); }, () => undefined);
    void loadSection<{ data: Audit[] }>("/api/v1/admin/audit").then((body) => { if (active) setAudit(body?.data); }, () => undefined);
    return () => { active = false; };
  }, [reloadToken]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pending) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "");
    const password = String(form.get("password") || "");
    setBusy(true); setError(""); setSuccess("");
    try {
      await reauthenticate(password);
      const operation = pending.kind === "MODERATE"
        ? moderationActionRequest(pending.room.roomId, pending.action, reason.trim())
        : preMatchVisibilityRequest(pending.room.roomId, pending.visible);
      const response = await fetch(operation.url, operation.init);
      const body = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(body.error?.message || "处理失败");
      setPending(undefined);
      setSuccess(pending.kind === "MODERATE"
        ? `${pending.room.name}：${ACTION_LABELS[pending.action]}已执行`
        : `${pending.room.name}：未开赛投入积分已${pending.visible ? "公开" : "隐藏"}`);
      setReloadToken((token) => token + 1);
    } catch (failure) { setError((failure as Error).message || "处理失败"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <AdminGovernanceView/>

    {success && <StatusMessage tone="success" title="处置已记录">{success}</StatusMessage>}
    {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}
    {pending && <GovernanceConfirmPanel
      title={pending.kind === "MODERATE" ? `确认对 ${pending.room.name} ${ACTION_LABELS[pending.action]}` : `确认调整 ${pending.room.name} 的投入可见性`}
      note={pending.kind === "MODERATE" ? ACTION_NOTES[pending.action] : "未开赛期间是否公开其他成员的投入积分。选择与倍率始终等到开赛后再按房主设置处理。"}
      verb={pending.kind === "MODERATE" ? ACTION_LABELS[pending.action] : pending.visible ? "公开投入" : "隐藏投入"}
      needsReason={pending.kind === "MODERATE"}
      busy={busy} onSubmit={confirm} onCancel={() => setPending(undefined)}/>}

    {rooms && <section className="surface p-5" aria-labelledby="room-governance-title">
      <h2 id="room-governance-title" className="display text-2xl font-bold">房间治理</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        举报之外的房间处置都在这里：限制、关闭与恢复需要理由和身份确认，可见性开关只需要身份确认。默认不公开未开赛的投入积分。
      </p>
      {rooms.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">暂无房间。</p> : <ul className="mt-4 space-y-3">{rooms.map((room) => <li key={room.roomId} className="rounded-xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <strong>{room.name}</strong>
            <p className="mt-1 text-xs text-[var(--muted)]">{room.status} · {room.memberCount} 位成员 · 开赛后完整记录{room.postMatchTicketVisible ? "公开" : "隐藏"}</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={room.preMatchStakeVisible} disabled={busy}
              onChange={(event) => { setError(""); setSuccess(""); setPending({ kind: "VISIBILITY", room, visible: event.target.checked }); }}
              className="size-5 accent-[var(--field)]"/>
            未开赛公开投入积分
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["RESTRICT", "CLOSE", "RESTORE"] as const).map((action) => <button key={action} type="button" disabled={busy}
            onClick={() => { setError(""); setSuccess(""); setPending({ kind: "MODERATE", room, action }); }}
            className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-xs font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-50">{ACTION_LABELS[action]}</button>)}
        </div>
      </li>)}</ul>}
    </section>}

    {audit && <section className="surface p-5" id="governance-audit" aria-labelledby="governance-audit-title">
      <h2 id="governance-audit-title" className="display text-2xl font-bold">最近审计</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">举报详情里的审计编号可以在这里对应到完整记录。</p>
      <ul className="mt-4 divide-y divide-[var(--line)]">{audit.slice(0, 50).map((item) => <li key={item.id} className="py-3 text-sm">
        <strong>{governanceActionLabel(item.action)}</strong>
        <span className="ml-2 text-xs text-[var(--muted)]">{item.targetType}:{item.targetId}</span>
        <p className="mt-1 text-xs text-[var(--muted)]">{item.actor ?? "系统"} · {dateTime.format(new Date(item.occurredAt))} · 审计 {item.id}</p>
      </li>)}</ul>
    </section>}
  </div>;
}

async function loadSection<T>(path: string): Promise<T | undefined> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return undefined;
  return await response.json() as T & ApiEnvelope<unknown>;
}

async function reauthenticate(password: string) {
  const request = moderationReauthRequest(password);
  const response = await fetch(request.url, request.init);
  const body = await response.json().catch(() => ({})) as ApiFailure;
  if (!response.ok) throw new Error(body.error?.message || "管理员身份确认失败");
}
