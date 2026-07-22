"use client";

import { FormEvent, useMemo, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import {
  MARKET_KIND_LABELS,
  sessionPredictable,
  type F1DriverView,
  type F1MarketKind,
  type F1MarketView,
  type F1SessionDetailView,
} from "./types";

const ticketErrors: Record<string, string> = {
  ODDS_CHANGED: "积分倍率已经变化，请查看最新倍率并再次确认。",
  MARKET_CLOSED: "本场次已封盘，本次提交未扣分。",
  DATA_UNAVAILABLE: "数据暂不可用，本次提交未扣分。",
  INSUFFICIENT_POINTS: "可用积分不足，请降低投入。",
  ADVANCED_ROOM_REQUIRED: "精确前三玩法仅在高级房间开放。",
  INVALID_STAKE: "投入必须是 1 – 20,000 的整数。",
};

/** F1 判断凭证：一次选择一个市场里的一个结果，冻结当下倍率快照提交。 */
export function F1PredictionSlip({ roomId, detail, advanced, interactive, onRefresh }: {
  roomId: string;
  detail: F1SessionDetailView;
  advanced: boolean;
  interactive: boolean;
  onRefresh: () => void;
}) {
  const markets = useMemo(() => {
    const order: F1MarketKind[] = ["WINNER", "POLE", "PODIUM", "EXACT_PODIUM", "H2H"];
    return [...detail.markets]
      .filter((market) => market.kind !== "EXACT_PODIUM" || advanced)
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [detail.markets, advanced]);

  const [marketId, setMarketId] = useState<string>();
  const [selection, setSelection] = useState<string>();
  const [stake, setStake] = useState("1000");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  const active = markets.find((market) => market.id === marketId) ?? markets[0];
  const outcome = active?.outcomes.find((candidate) => candidate.selection === selection);
  const predictable = sessionPredictable(detail.session) && interactive;
  const unavailable = !predictable || !active || active.status !== "OPEN";

  const projected = useMemo(() => {
    const amount = Number(stake), value = Number(outcome?.decimalOdds);
    return outcome && Number.isFinite(amount * value) ? (amount * value).toFixed(2) : "—";
  }, [stake, outcome]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!active || !outcome) return;
    setPending(true); setError(""); setReceipt("");
    try {
      const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          matchId: `f1:${detail.session.id}`,
          marketId: active.id,
          marketVersion: active.version,
          selection: outcome.selection,
          stakePoints: stake,
          acceptedOdds: outcome.decimalOdds,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string }; data?: { ticketId?: string } };
      if (!response.ok) {
        const code = result.error?.code || "UNKNOWN";
        if (code === "ODDS_CHANGED") { onRefresh(); setSelection(undefined); }
        setError(ticketErrors[code] || result.error?.message || "提交失败，本次积分未发生变化。");
        return;
      }
      setReceipt(result.data?.ticketId || "已记录");
    } catch { setError("网络连接失败。系统不会离线排队，本次积分未发生变化。"); }
    finally { setPending(false); }
  }

  if (!markets.length) {
    return <section className="surface p-5"><h3 className="display text-xl font-bold">F1 判断</h3><p className="mt-2 text-sm text-[var(--muted)]">本场次还没有开放市场。管理员发布倍率后即可提交判断。</p></section>;
  }

  return (
    <form onSubmit={submit} className="surface space-y-4 p-4 sm:p-5" aria-label="F1 判断凭证">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-xl font-bold">F1 判断</h3>
        <p className="text-xs text-[var(--muted)]">倍率版本 <span className="tabular">{active?.version}</span></p>
      </header>

      <div role="tablist" aria-label="选择市场" className="flex flex-wrap gap-2">
        {markets.map((market) => (
          <button key={market.id} type="button" role="tab" aria-selected={market.id === active?.id}
            onClick={() => { setMarketId(market.id); setSelection(undefined); setError(""); setReceipt(""); }}
            className={`min-h-10 rounded-full border-2 px-4 text-sm font-bold transition ${market.id === active?.id ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}>
            {MARKET_KIND_LABELS[market.kind]}
          </button>
        ))}
      </div>

      {active && <OutcomePicker market={active} drivers={detail.drivers} selection={selection} disabled={unavailable || pending} onSelect={(value) => { setSelection(value); setError(""); setReceipt(""); }} />}

      <div>
        <label htmlFor={`f1-stake-${detail.session.id}`} className="mb-2 block text-sm font-bold">投入积分</label>
        <input id={`f1-stake-${detail.session.id}`} disabled={unavailable || pending} type="number" inputMode="numeric" min="1" max="20000" step="1" required value={stake} onChange={(event) => setStake(event.target.value)} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3 tabular" />
        <div className="mt-2 flex flex-wrap gap-2">{["500", "1000", "2000"].map((value) => (
          <button key={value} disabled={unavailable || pending} type="button" onClick={() => setStake(value)} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-bold transition hover:border-[var(--field)] hover:text-[var(--field)]">{Number(value).toLocaleString()}</button>
        ))}</div>
      </div>

      <div className="flex justify-between border-y rule py-3 text-sm"><span className="text-[var(--muted)]">预计返还（含投入）</span><strong className="tabular">{projected}</strong></div>
      {error && <StatusMessage tone="error" title="未提交">{error}</StatusMessage>}
      {receipt && <StatusMessage tone="success" title="判断已记录">票号：<span className="tabular">{receipt}</span></StatusMessage>}
      <button disabled={unavailable || pending || !outcome || !stake} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45">
        {pending ? "正在复核倍率与封盘状态…" : unavailable ? "当前不可提交" : "确认最新倍率并提交"}
      </button>
      <p className="text-xs leading-5 text-[var(--muted)]">投入必须为整数，单张上限 20,000 分。服务端将复核封盘时间与倍率版本；失败时不冻结积分。{advanced ? "精确前三按 P1→P2→P3 顺序判定。" : "精确前三玩法仅在高级房间开放。"}</p>
    </form>
  );
}

function OutcomePicker({ market, drivers, selection, disabled, onSelect }: {
  market: F1MarketView;
  drivers: F1DriverView[];
  selection?: string;
  disabled: boolean;
  onSelect: (selection: string) => void;
}) {
  const driverIndex = useMemo(() => new Map(drivers.map((driver) => [driver.code, driver])), [drivers]);
  const buttonClass = (selected: boolean) =>
    `rounded-lg border-2 px-2 py-2 text-left text-sm font-bold transition ${selected ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`;

  if (market.kind === "POLE" || market.kind === "WINNER") {
    return <fieldset disabled={disabled}>
      <legend className="mb-2 text-sm font-bold">选择{MARKET_KIND_LABELS[market.kind]}车手</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {market.outcomes.map((outcome) => {
          const code = outcome.selection.replace(/^DRV:/, "");
          const driver = driverIndex.get(code);
          return <button key={outcome.selection} type="button" aria-pressed={selection === outcome.selection} onClick={() => onSelect(outcome.selection)} className={buttonClass(selection === outcome.selection)}>
            <span className="flex items-center gap-2">
              <i aria-hidden className="h-4 w-1 shrink-0 rounded-sm" style={{ background: driver?.color ?? "var(--muted)" }} />
              <span className="min-w-0 flex-1 truncate">{code}</span>
              <span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span>
            </span>
            {driver && <span className={`mt-0.5 block truncate text-[10px] font-normal ${selection === outcome.selection ? "opacity-80" : "text-[var(--muted)]"}`}>{driver.name}</span>}
          </button>;
        })}
      </div>
    </fieldset>;
  }

  if (market.kind === "PODIUM") {
    return <fieldset disabled={disabled}>
      <legend className="mb-2 text-sm font-bold">选择车手是否登上领奖台（前三）</legend>
      <div className="grid grid-cols-2 gap-2">
        {market.outcomes.map((outcome) => {
          const parsed = /^PODIUM:(.+):(YES|NO)$/.exec(outcome.selection);
          const label = parsed ? `${parsed[1]} ${parsed[2] === "YES" ? "登台" : "不登台"}` : outcome.selection;
          return <button key={outcome.selection} type="button" aria-pressed={selection === outcome.selection} onClick={() => onSelect(outcome.selection)} className={buttonClass(selection === outcome.selection)}>
            <span className="flex items-center justify-between gap-2"><span className="truncate">{label}</span><span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span></span>
          </button>;
        })}
      </div>
    </fieldset>;
  }

  if (market.kind === "EXACT_PODIUM") {
    return <fieldset disabled={disabled}>
      <legend className="mb-2 text-sm font-bold">选择精确前三（P1 → P2 → P3，顺序判定）</legend>
      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {market.outcomes.map((outcome) => {
          const parsed = /^POD3:(.+)-(.+)-(.+)$/.exec(outcome.selection);
          const label = parsed ? `${parsed[1]} → ${parsed[2]} → ${parsed[3]}` : outcome.selection;
          return <button key={outcome.selection} type="button" aria-pressed={selection === outcome.selection} onClick={() => onSelect(outcome.selection)} className={buttonClass(selection === outcome.selection)}>
            <span className="flex items-center justify-between gap-2"><span className="tabular truncate">{label}</span><span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span></span>
          </button>;
        })}
      </div>
    </fieldset>;
  }

  return <fieldset disabled={disabled}>
    <legend className="mb-2 text-sm font-bold">选择车手对决（谁的完赛名次更靠前）</legend>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {market.outcomes.map((outcome) => {
        const parsed = /^H2H:(.+)>(.+)$/.exec(outcome.selection);
        const label = parsed ? `${parsed[1]} 先于 ${parsed[2]}` : outcome.selection;
        const driver = parsed ? driverIndex.get(parsed[1]) : undefined;
        return <button key={outcome.selection} type="button" aria-pressed={selection === outcome.selection} onClick={() => onSelect(outcome.selection)} className={buttonClass(selection === outcome.selection)}>
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-4 w-1 shrink-0 rounded-sm" style={{ background: driver?.color ?? "var(--muted)" }} />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span>
          </span>
        </button>;
      })}
    </div>
  </fieldset>;
}
