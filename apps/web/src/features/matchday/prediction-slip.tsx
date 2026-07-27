"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { OddsButton } from "@/components/odds-button";
import { StatusMessage } from "@/components/status-message";
import { discardOfflineDraft, loadOfflineDraft, revalidateDraft, saveOfflineDraft, type DraftVerdict, type OfflineDraft } from "@/features/pwa/offline-draft";
import { useOnlineStatus } from "@/features/pwa/offline-status";
import { formatPoints } from "@/lib/points";
import { scoreChipLabel } from "./selection-label";
import { matchViewFromDetailPayload } from "./types";
import type { ApiFailure, MatchView, OddsSelection } from "./types";

const ticketErrors: Record<string, string> = {
  ODDS_CHANGED: "积分倍率已经变化，请查看最新倍率并再次确认。",
  MARKET_CLOSED: "比赛已经封盘，本次提交未扣分。",
  DATA_UNAVAILABLE: "数据暂不可用，本次提交未扣分。",
  INSUFFICIENT_POINTS: "可用积分不足，请降低投入。",
  DUPLICATE_SUBMISSION: "你已经提交过这场判断。",
  ADVANCED_ROOM_REQUIRED: "买比分玩法仅在高级房间开放。",
  ROOM_SPORT_MISMATCH: "当前房间是 F1 竞猜房，不能提交足球判断；请切换到足球房间。",
  SCORE_TICKET_EXISTS: "本场比赛你已有一张未结算的比分预测。",
  MARKET_TICKET_EXISTS: "本盘口你已提交过判断，等待结算即可。",
  ROUND_IN_PROGRESS: "本群组当前轮次尚未全部结算，暂不能开启另一场比赛。",
};

type MarketKind = "1X2" | "CS";

const MARKET_LABELS: Record<MarketKind, string> = { "1X2": "胜平负", CS: "买比分" };

/** 一人一注：每个盘口只能提交一次判断，已投的盘口只等待结算。已投盘口集合由
 *  房间列表统一拉取（每张卡片各拉一次会在一屏比赛上打出几十个请求），提交成功
 *  或服务端回 409 时就地补上。 */
export function PredictionSlip({ roomId, match, advanced = false, placedMarketIds, onAccepted }: { roomId: string; match: MatchView; advanced?: boolean; placedMarketIds?: ReadonlySet<string>; onAccepted?: () => void }) {
  // match 是父组件的静态 prop；遇到 ODDS_CHANGED 时用重拉的最新赔率覆盖它，
  // 否则再次提交仍带旧版本号，会永远撞 ODDS_CHANGED。
  const [freshMatch, setFreshMatch] = useState<MatchView>();
  const current = freshMatch ?? match;
  const oneXTwo = current.market;
  const correctScore = advanced ? current.correctScore : undefined;
  const canBuyScore = Boolean(correctScore);

  const [marketChoice, setMarket] = useState<MarketKind>();
  const [selection, setSelection] = useState<OddsSelection>();
  const [scoreSelection, setScoreSelection] = useState<string>();
  const [stake, setStake] = useState("1000");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  // 本次会话内新投的盘口；与父组件下发的服务端已投态合并。
  const [justPlaced, setJustPlaced] = useState<ReadonlySet<string>>(new Set());
  const placed = useMemo(() => new Set([...(placedMarketIds ?? []), ...justPlaced]), [placedMarketIds, justPlaced]);
  const isPlaced = (id: string | number | undefined) => id !== undefined && placed.has(String(id));

  // 用户没主动切过盘口时，默认停在还没投过的那个。
  const market: MarketKind = marketChoice ?? (canBuyScore && isPlaced(oneXTwo?.id) && !isPlaced(correctScore?.id) ? "CS" : "1X2");

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
    return active?.decimalOdds && Number.isFinite(amount * value) ? formatPoints((amount * value).toFixed(2)) : "—";
  }, [stake, active]);

  // 7.3a：离线禁提交；7.3b：离线仍可继续构建判断（存为本地草稿），只有提交被禁。
  const online = useOnlineStatus();
  const activePlaced = isPlaced(active?.id);
  const closed = current.state !== "OPEN" || activePlaced;
  const unavailable = closed || !active?.id || !online;

  // 7.3b —— 离线草稿：离线时把当前选择随手保存；回网重载后恢复，但必须重新验证
  // （倍率/盘口版本/开赛状态任何一项变化都要求重选或明确丢弃），且永不自动提交。
  const [draft, setDraft] = useState<OfflineDraft | null>(null);
  const [draftVerdict, setDraftVerdict] = useState<DraftVerdict | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (online || !active?.id || !active.selection || !active.decimalOdds || !stake) return;
    saveOfflineDraft({ v: 1, roomId, eventKey: match.id, marketId: String(active.id), marketVersion: active.version, selection: active.selection, decimalOdds: active.decimalOdds, stakePoints: stake, savedAt: new Date().toISOString() });
  }, [online, active, stake, roomId, match.id]);

  useEffect(() => {
    if (!online || restoredRef.current) return;
    restoredRef.current = true;
    // 微任务回调里恢复：localStorage 是外部系统，且避免 effect 内同步 setState 级联渲染。
    queueMicrotask(() => {
      const stored = loadOfflineDraft(roomId, match.id);
      if (!stored) return;
      const target = correctScore && String(correctScore.id) === stored.marketId
        ? { kind: "CS" as MarketKind, id: correctScore.id, version: correctScore.version, odds: correctScore.outcomes.find((outcome) => outcome.selection === stored.selection)?.decimalOdds }
        : oneXTwo && String(oneXTwo.id) === stored.marketId
          ? { kind: "1X2" as MarketKind, id: oneXTwo.id, version: oneXTwo.version, odds: (["HOME", "DRAW", "AWAY"] as const).some((value) => value === stored.selection) ? ({ HOME: oneXTwo.home, DRAW: oneXTwo.draw, AWAY: oneXTwo.away })[stored.selection as OddsSelection] : undefined }
          : undefined;
      const verdict = revalidateDraft(stored, { open: current.state === "OPEN", marketId: target?.id, marketVersion: target?.version, decimalOdds: target?.odds });
      if (verdict === "UNCHANGED" && target) {
        setMarket(target.kind);
        if (target.kind === "CS") setScoreSelection(stored.selection);
        else setSelection(stored.selection as OddsSelection);
        setStake(stored.stakePoints);
      }
      setDraft(stored);
      setDraftVerdict(verdict);
    });
  }, [online, roomId, match.id, correctScore, oneXTwo, current.state]);

  function clearDraft() {
    discardOfflineDraft(roomId, match.id);
    setDraft(null);
    setDraftVerdict(null);
  }

  async function refreshOdds() {
    try {
      const response = await fetch(`/api/v1/matches/${encodeURIComponent(match.id)}`, { credentials: "same-origin", cache: "no-store" });
      const view = response.ok ? matchViewFromDetailPayload(await response.json().catch(() => null)) : null;
      if (view) {
        setFreshMatch(view);
        setError("积分倍率已经变化，已为你更新为最新倍率，请确认后再次提交。");
        return;
      }
    } catch { /* 拉取失败时退回手动提示 */ }
    setError(ticketErrors.ODDS_CHANGED);
  }

  function markPlaced() {
    const id = active?.id;
    if (id !== undefined) setJustPlaced((previous) => new Set(previous).add(String(id)));
  }

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
      if (!response.ok) {
        const code = result.error?.code || "UNKNOWN";
        if (code === "ODDS_CHANGED") { await refreshOdds(); return; }
        // 服务端说这个盘口已有未结算判断：同步已投态，界面切到等待结算。
        if (code === "MARKET_TICKET_EXISTS" || code === "SCORE_TICKET_EXISTS") markPlaced();
        setError(ticketErrors[code] || result.error?.message || "提交失败，本次积分未发生变化。"); return;
      }
      setReceipt(result.data?.ticketId || "已记录");
      markPlaced();
      // 选中态已被消费：清掉它，避免之后离线时把已提交的判断又存成草稿。
      setSelection(undefined);
      setScoreSelection(undefined);
      clearDraft();
      onAccepted?.();
    } catch { setError("网络连接失败。系统不会离线排队，本次积分未发生变化。"); }
    finally { setPending(false); }
  }

  return <form onSubmit={submit} className="space-y-4">
    {canBuyScore && <div className="grid grid-cols-2 gap-2">{([["1X2", MARKET_LABELS["1X2"], oneXTwo?.id], ["CS", MARKET_LABELS.CS, correctScore?.id]] as const).map(([value, label, id]) => <button key={value} type="button" aria-pressed={market === value} onClick={() => { setMarket(value); setError(""); setReceipt(""); }} className={`min-h-10 rounded-full border-2 px-4 text-sm font-bold transition ${market === value ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}>{label}{isPlaced(id) ? " ✓已投" : ""}</button>)}</div>}

    {activePlaced
      ? <StatusMessage tone="info" title={`${MARKET_LABELS[market]}已提交判断`}>本盘口只能提交一次判断，积分已冻结；赛果确认后自动结算，无需任何操作。</StatusMessage>
      : <>
        {market === "CS" && correctScore
          ? <fieldset disabled={closed || pending}><legend className="mb-2 text-sm font-bold">选择最终比分（主队 : 客队）</legend><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{correctScore.outcomes.map((outcome) => <button key={outcome.selection} type="button" aria-pressed={scoreSelection === outcome.selection} onClick={() => setScoreSelection(outcome.selection)} className={`pulse-pick flex min-h-14 flex-col items-center justify-center rounded-lg border-2 px-1 text-sm font-bold transition ${scoreSelection === outcome.selection ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}><span>{scoreChipLabel(outcome.selection)}</span><span className="tabular text-xs font-black opacity-90">{outcome.decimalOdds}</span></button>)}</div></fieldset>
          : <fieldset disabled={closed || pending}><legend className="mb-2 text-sm font-bold">选择你的判断</legend><div className="grid grid-cols-3 gap-2"><OddsButton selection="HOME" label="主胜" odds={oneXTwo?.home || "—"} selected={selection === "HOME"} onSelect={setSelection}/><OddsButton selection="DRAW" label="平局" odds={oneXTwo?.draw || "—"} selected={selection === "DRAW"} onSelect={setSelection}/><OddsButton selection="AWAY" label="客胜" odds={oneXTwo?.away || "—"} selected={selection === "AWAY"} onSelect={setSelection}/></div></fieldset>}

        <div><label htmlFor={`stake-${match.id}`} className="mb-2 block text-sm font-bold">投入积分</label><input id={`stake-${match.id}`} disabled={closed || pending} type="number" inputMode="numeric" min="1" max="20000" step="1" required value={stake} onChange={event => setStake(event.target.value)} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3 tabular"/><div className="mt-2 flex flex-wrap gap-2">{["500", "1000", "2000"].map(value => <button key={value} disabled={closed || pending} type="button" onClick={() => setStake(value)} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-bold transition hover:border-[var(--field)] hover:text-[var(--field)]">{Number(value).toLocaleString()}</button>)}</div></div>
        <div className={`pulse-confirm text-sm ${active?.selection && active.decimalOdds ? "is-armed" : ""}`}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[var(--muted)]">预计返还（含投入）</span>
            {active?.selection && active.decimalOdds && <span className="pulse-confirm__lock">已锁定 {active.decimalOdds}x</span>}
          </span>
          <strong key={`${active?.selection ?? "none"}-${projected}`} className="pulse-confirm__value tabular">{projected}</strong>
        </div>
      </>}
    {draft && draftVerdict && <StatusMessage tone={draftVerdict === "UNCHANGED" ? "info" : "error"} title={draftVerdict === "UNCHANGED" ? "已恢复离线草稿" : "离线草稿需要处理"}>
      <span className="block">
        {draftVerdict === "UNCHANGED" && "离线时保存的判断已恢复。系统不会自动提交，请确认最新倍率后手动提交。"}
        {draftVerdict === "ODDS_CHANGED" && `离线期间积分倍率已变化（草稿倍率 ${draft.decimalOdds}），请按最新倍率重新选择，或丢弃这份草稿。`}
        {draftVerdict === "MARKET_CHANGED" && "离线期间盘口已更换，这份草稿无法提交，请重新选择或丢弃。"}
        {draftVerdict === "EVENT_CLOSED" && "比赛已封盘，这份离线草稿无法提交，请丢弃。"}
      </span>
      <button type="button" onClick={clearDraft} className="mt-2 inline-flex min-h-8 items-center rounded-full border border-[var(--line)] bg-white px-3 text-xs font-bold text-[var(--ink)] transition hover:border-[var(--field)] hover:text-[var(--field)]">丢弃草稿</button>
    </StatusMessage>}
    {error && <StatusMessage tone="error" title="未提交">{error}</StatusMessage>}
    {receipt && <div className="pulse-stamp"><StatusMessage tone="success" title="判断已记录">票号：<span className="tabular">{receipt}</span></StatusMessage></div>}
    {!activePlaced && <button disabled={unavailable || pending || !active?.selection || !stake} className={`inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 ${active?.selection && active.decimalOdds && !unavailable ? "pulse-submit-armed" : ""}`}>{pending ? "正在复核倍率与封盘状态…" : !online ? "离线中，提交已禁用" : unavailable ? "当前不可提交" : "确认最新倍率并提交"}</button>}
    <p className="text-xs leading-5 text-[var(--muted)]">投入必须为整数。服务端将复核实际开球、封盘和积分倍率；失败时不冻结积分，单张上限 20,000 分。每个盘口只能提交一次判断，提交后等待结算。{market === "CS" ? "买比分每场只能持有一张未结算预测。" : ""}</p>
  </form>;
}
