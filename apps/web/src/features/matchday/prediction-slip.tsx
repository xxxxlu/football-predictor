"use client";
import { FormEvent, useMemo, useState } from "react";
import { OddsButton } from "@/components/odds-button";
import { StatusMessage } from "@/components/status-message";
import { scoreChipLabel } from "./selection-label";
import type { ApiFailure, MatchView, OddsSelection } from "./types";

const ticketErrors: Record<string, string> = {
  ODDS_CHANGED: "积分倍率已经变化，请查看最新倍率并再次确认。",
  MARKET_CLOSED: "比赛已经封盘，本次提交未扣分。",
  DATA_UNAVAILABLE: "数据暂不可用，本次提交未扣分。",
  INSUFFICIENT_POINTS: "可用积分不足，请降低投入。",
  DUPLICATE_SUBMISSION: "你已经提交过这场判断。",
  ADVANCED_ROOM_REQUIRED: "买比分玩法仅在高级房间开放。",
  SCORE_TICKET_EXISTS: "本场比赛你已有一张未结算的比分预测。",
};

type MarketKind = "1X2" | "CS";

export function PredictionSlip({ roomId, match, advanced = false, onAccepted }: { roomId: string; match: MatchView; advanced?: boolean; onAccepted?: () => void }) {
  const oneXTwo = match.market;
  const correctScore = advanced ? match.correctScore : undefined;
  const canBuyScore = Boolean(correctScore);

  const [market, setMarket] = useState<MarketKind>("1X2");
  const [selection, setSelection] = useState<OddsSelection>();
  const [scoreSelection, setScoreSelection] = useState<string>();
  const [stake, setStake] = useState("1000");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  // The market currently in focus, resolved to the fields the /tickets endpoint needs.
  const active = useMemo(() => {
    if (market === "CS" && correctScore) {
      const decimalOdds = scoreSelection ? correctScore.outcomes.find((outcome) => outcome.selection === scoreSelection)?.decimalOdds : undefined;
      return { id: correctScore.id, version: correctScore.version, selection: scoreSelection, decimalOdds };
    }
    if (oneXTwo) {
      const decimalOdds = selection ? ({ HOME: oneXTwo.home, DRAW: oneXTwo.draw, AWAY: oneXTwo.away })[selection] : undefined;
      return { id: oneXTwo.id, version: oneXTwo.version, selection, decimalOdds };
    }
    return undefined;
  }, [market, correctScore, oneXTwo, selection, scoreSelection]);

  const projected = useMemo(() => {
    const amount = Number(stake), value = Number(active?.decimalOdds);
    return active?.decimalOdds && Number.isFinite(amount * value) ? (amount * value).toFixed(2) : "—";
  }, [stake, active]);

  const unavailable = match.state !== "OPEN" || !active?.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!active?.id || !active.selection || !active.decimalOdds) return;
    setPending(true); setError(""); setReceipt("");
    try {
      const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ matchId: match.id, marketId: active.id, marketVersion: active.version, selection: active.selection, stakePoints: stake, acceptedOdds: active.decimalOdds }),
      });
      const result = await response.json().catch(() => ({})) as ApiFailure & { data?: { ticketId?: string } };
      if (!response.ok) { const code = result.error?.code || "UNKNOWN"; setError(ticketErrors[code] || result.error?.message || "提交失败，本次积分未发生变化。"); return; }
      setReceipt(result.data?.ticketId || "已记录");
      onAccepted?.();
    } catch { setError("网络连接失败。系统不会离线排队，本次积分未发生变化。"); }
    finally { setPending(false); }
  }

  return <form onSubmit={submit} className="space-y-4">
    {canBuyScore && <div className="grid grid-cols-2 gap-2">{([["1X2", "胜平负"], ["CS", "买比分"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={market === value} onClick={() => { setMarket(value); setError(""); setReceipt(""); }} className={`min-h-10 rounded-full border-2 px-4 text-sm font-bold transition ${market === value ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}>{label}</button>)}</div>}

    {market === "CS" && correctScore
      ? <fieldset disabled={unavailable || pending}><legend className="mb-2 text-sm font-bold">选择最终比分（主队 : 客队）</legend><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{correctScore.outcomes.map((outcome) => <button key={outcome.selection} type="button" aria-pressed={scoreSelection === outcome.selection} onClick={() => setScoreSelection(outcome.selection)} className={`flex min-h-14 flex-col items-center justify-center rounded-lg border-2 px-1 text-sm font-bold transition ${scoreSelection === outcome.selection ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}><span>{scoreChipLabel(outcome.selection)}</span><span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span></button>)}</div></fieldset>
      : <fieldset disabled={unavailable || pending}><legend className="mb-2 text-sm font-bold">选择你的判断</legend><div className="grid grid-cols-3 gap-2"><OddsButton selection="HOME" label="主胜" odds={oneXTwo?.home || "—"} selected={selection === "HOME"} onSelect={setSelection}/><OddsButton selection="DRAW" label="平局" odds={oneXTwo?.draw || "—"} selected={selection === "DRAW"} onSelect={setSelection}/><OddsButton selection="AWAY" label="客胜" odds={oneXTwo?.away || "—"} selected={selection === "AWAY"} onSelect={setSelection}/></div></fieldset>}

    <div><label htmlFor={`stake-${match.id}`} className="mb-2 block text-sm font-bold">投入积分</label><input id={`stake-${match.id}`} disabled={unavailable || pending} type="number" inputMode="numeric" min="1" max="20000" step="1" required value={stake} onChange={event => setStake(event.target.value)} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3 tabular"/><div className="mt-2 flex flex-wrap gap-2">{["500", "1000", "2000"].map(value => <button key={value} disabled={unavailable || pending} type="button" onClick={() => setStake(value)} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-bold transition hover:border-[var(--field)] hover:text-[var(--field)]">{Number(value).toLocaleString()}</button>)}</div></div>
    <div className="flex justify-between border-y rule py-3 text-sm"><span className="text-[var(--muted)]">预计返还（含投入）</span><strong className="tabular">{projected}</strong></div>
    {error && <StatusMessage tone="error" title="未提交">{error}</StatusMessage>}
    {receipt && <StatusMessage tone="success" title="判断已记录">票号：<span className="tabular">{receipt}</span></StatusMessage>}
    <button disabled={unavailable || pending || !active?.selection || !stake} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45">{pending ? "正在复核倍率与封盘状态…" : unavailable ? "当前不可提交" : "确认最新倍率并提交"}</button>
    <p className="text-xs leading-5 text-[var(--muted)]">投入必须为整数。服务端将复核实际开球、封盘和积分倍率；失败时不冻结积分，单张上限 20,000 分。{market === "CS" ? "买比分每场只能持有一张未结算预测。" : ""}</p>
  </form>;
}
