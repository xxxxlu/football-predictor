"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { formatPoints } from "@/lib/points";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import {
  grantCreateRequest,
  grantDecisionRequest,
  grantErrorMessage,
  grantListRequest,
  splitGrantList,
  summarizeApprovedGrants,
  type GrantList,
  type GrantRecord,
} from "./room-grants";

/**
 * Room grants panel (Story 8.1, FR43-FR45): a member asks, the owner decides
 * the amount. Hiding the form is never the authorization boundary — every rule
 * here is re-enforced on the server.
 */
export function RoomGrantsPanel({ roomId, active, onBalanceChanged }: { roomId: string; active: boolean; onBalanceChanged?: () => void }) {
  const [list, setList] = useState<GrantList>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { url, init } = grantListRequest(roomId);
        const response = await fetch(url, { ...init, signal: controller.signal });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<GrantList> & ApiFailure;
        if (!response.ok) throw new Error(grantErrorMessage(result.error?.code, result.error?.message || "无法加载补分记录"));
        if (!controller.signal.aborted) { setList(result.data); setError(""); }
      } catch (reason) {
        if (!controller.signal.aborted && (reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载补分记录");
      }
    })();
    return () => controller.abort();
  }, [roomId, reload]);

  // The story's notification decision leans on the room page's 30s cadence:
  // the requester sees an approval (and the owner a new request) without a
  // manual reload, but only while the tab is actually visible.
  useVisibleInterval(refresh, 30_000);

  if (!list) {
    return <section className="surface p-5" aria-labelledby="room-grants-title">
      <h2 id="room-grants-title" className="display text-xl font-bold">房间补分</h2>
      {error ? <div className="mt-3"><StatusMessage tone="error" title="补分记录暂不可用">{error}</StatusMessage></div> : <p className="mt-2 text-sm text-[var(--muted)]">正在加载补分记录…</p>}
    </section>;
  }

  const { open, approved, minePending, mineDenied } = splitGrantList(list);
  const summary = summarizeApprovedGrants(approved);

  return <section className="surface p-5" aria-labelledby="room-grants-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">ROOM GRANTS</p>
        <h2 id="room-grants-title" className="display mt-1 text-2xl font-bold">房间补分</h2>
      </div>
    </div>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">积分用完可以向房主申请补分，数量由房主审批时决定（单次最多 20,000 分）。补分记录对全体成员公开，单独展示且<b className="text-[var(--ink)]">不计入净积分与排行榜</b>。</p>
    {error && <div className="mt-3"><StatusMessage tone="error" title="操作失败">{error}</StatusMessage></div>}
    {notice && <div className="mt-3"><StatusMessage tone="success" title={notice}/></div>}

    {list.isOwner
      ? <OwnerQueue roomId={roomId} open={open} active={active} onDone={(message) => { setNotice(message); setError(""); refresh(); onBalanceChanged?.(); }} onError={(message) => { setError(message); setNotice(""); }}/>
      : <MemberRequest roomId={roomId} pending={minePending} denied={mineDenied} active={active} onDone={(message) => { setNotice(message); setError(""); refresh(); }} onError={(message) => { setError(message); setNotice(""); }}/>}

    <div className="mt-5">
      <h3 className="text-sm font-bold">已批准的补分（{approved.length} 次）</h3>
      {summary.length === 0
        ? <p className="mt-2 text-sm text-[var(--muted)]">本房间还没有批准过补分。</p>
        : <ul className="mt-2 divide-y divide-[var(--line)]">
            {summary.map((entry) => <li key={entry.userId} className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
              <span className="truncate font-bold">{entry.displayName}</span>
              <span className="tabular text-[var(--muted)]">{entry.count} 次 · 共 {formatPoints(String(entry.totalPoints))} 分</span>
            </li>)}
          </ul>}
    </div>
  </section>;
}

function MemberRequest({ roomId, pending, denied, active, onDone, onError }: {
  roomId: string; pending?: GrantRecord; denied?: GrantRecord; active: boolean;
  onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (pending) {
    return <div className="mt-4"><StatusMessage tone="info" title="补分申请等待房主处理">
      提交于 {new Date(pending.requestedAt).toLocaleString("zh-CN")}{pending.note ? `：“${pending.note}”` : ""}。房主批准后积分会直接进入你的可用余额。
    </StatusMessage></div>;
  }

  async function submit() {
    setSubmitting(true);
    try {
      const { url, init } = grantCreateRequest(roomId, note);
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(grantErrorMessage(result.error?.code, result.error?.message || "补分申请提交失败"));
      setNote("");
      onDone("补分申请已提交，等待房主处理");
    } catch (reason) {
      onError((reason as Error).message || "补分申请提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="mt-4">
    {denied && !active ? null : denied ? <div className="mb-3"><StatusMessage tone="info" title="上一条申请未获批准">{denied.decisionNote ? `房主说明：“${denied.decisionNote}”。` : ""}你可以再次申请。</StatusMessage></div> : null}
    {active
      ? <div>
          <label htmlFor="grant-note" className="block text-xs font-bold">申请说明（可选，200 字以内）</label>
          <textarea id="grant-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} rows={2} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm" placeholder="例如：积分已用完，想继续参与本轮预测"/>
          <button type="button" onClick={() => void submit()} disabled={submitting} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-5 font-bold text-white transition hover:brightness-95 disabled:opacity-55">{submitting ? "正在提交…" : "申请补分"}</button>
        </div>
      : <p className="text-sm text-[var(--muted)]">房间当前不在开放状态，暂不能申请补分。</p>}
  </div>;
}

function OwnerQueue({ roomId, open, active, onDone, onError }: {
  roomId: string; open: GrantRecord[]; active: boolean;
  onDone: (message: string) => void; onError: (message: string) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  async function decide(row: GrantRecord, decision: { action: "APPROVE"; amount: number } | { action: "DENY" }) {
    setBusy(row.id);
    try {
      const { url, init } = grantDecisionRequest(roomId, row.id, decision);
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(grantErrorMessage(result.error?.code, result.error?.message || "处理失败"));
      onDone(decision.action === "APPROVE" ? `已为 ${row.requester.displayName} 补分 ${formatPoints(String(decision.amount))} 分` : `已拒绝 ${row.requester.displayName} 的补分申请`);
    } catch (reason) {
      onError((reason as Error).message || "处理失败");
    } finally {
      setBusy("");
    }
  }

  if (open.length === 0) return <p className="mt-4 text-sm text-[var(--muted)]">当前没有待处理的补分申请。</p>;
  if (!active) return <div className="mt-4"><StatusMessage tone="info" title="房间不在开放状态">有 {open.length} 条待处理申请，待房间恢复开放后可审批。</StatusMessage></div>;

  return <ul className="mt-4 space-y-4">
    {open.map((row) => {
      const amount = amounts[row.id] ?? "";
      const parsed = Number(amount);
      const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20_000;
      return <li key={row.id} className="rounded-xl border border-[var(--line)] p-4">
        <p className="text-sm"><b>{row.requester.displayName}</b> 申请补分 · {new Date(row.requestedAt).toLocaleString("zh-CN")}</p>
        {row.note && <p className="mt-1 text-sm text-[var(--muted)]">“{row.note}”</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor={`grant-amount-${row.id}`} className="text-xs font-bold">补分数量</label>
          <input id={`grant-amount-${row.id}`} inputMode="numeric" value={amount} onChange={(event) => setAmounts((prev) => ({ ...prev, [row.id]: event.target.value }))} placeholder="1 – 20,000" className="w-32 min-h-11 rounded-lg border border-[var(--line)] bg-white px-3 text-sm"/>
          <button type="button" disabled={!valid || busy === row.id} onClick={() => void decide(row, { action: "APPROVE", amount: parsed })} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-5 font-bold text-white transition hover:brightness-95 disabled:opacity-55">{busy === row.id ? "处理中…" : "批准"}</button>
          <button type="button" disabled={busy === row.id} onClick={() => void decide(row, { action: "DENY" })} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--coral)] px-5 font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-55">拒绝</button>
        </div>
        {amount && !valid && <p className="mt-2 text-xs text-[var(--coral)]">补分数量须为 1 到 20,000 之间的整数。</p>}
      </li>;
    })}
  </ul>;
}
