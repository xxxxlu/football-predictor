"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { exactPodiumComboOdds } from "@pulse/domain";
import { StatusMessage } from "@/components/status-message";
import { discardOfflineDraft, loadOfflineDraft, revalidateDraft, saveOfflineDraft, type DraftVerdict, type OfflineDraft } from "@/features/pwa/offline-draft";
import { useOnlineStatus } from "@/features/pwa/offline-status";
import { formatPoints } from "@/lib/points";
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
  MARKET_TICKET_EXISTS: "本盘口你已提交过判断，等待结算即可。",
  ROOM_SPORT_MISMATCH: "当前房间是足球竞猜房，不能提交 F1 判断；请切换到 F1 房间。",
  INVALID_STAKE: "投入必须是 1 – 20,000 的整数。",
};

const POD3_PATTERN = /^POD3:([A-Z0-9]{2,4})-([A-Z0-9]{2,4})-([A-Z0-9]{2,4})$/;

/** Resolves the displayed odds for a selection. Direct outcomes match by string;
 *  领奖台之争 combos are derived from the market's per-driver base odds via the same
 *  domain formula the server validates against, so what the user locks is exactly
 *  what the server will freeze. Legacy snapshots with enumerated `POD3:` outcomes
 *  still match on the direct path. */
function resolveOutcome(market: F1MarketView | undefined, selection: string | undefined): { selection: string; decimalOdds: string } | undefined {
  if (!market || !selection) return undefined;
  const direct = market.outcomes.find((candidate) => candidate.selection === selection);
  if (direct) return direct;
  if (market.kind !== "EXACT_PODIUM") return undefined;
  const parsed = POD3_PATTERN.exec(selection);
  if (!parsed) return undefined;
  const base = [parsed[1], parsed[2], parsed[3]].map((code) =>
    market.outcomes.find((candidate) => candidate.selection === `DRV:${code}`)?.decimalOdds);
  if (base[0] === undefined || base[1] === undefined || base[2] === undefined) return undefined;
  const derived = exactPodiumComboOdds([base[0], base[1], base[2]]);
  return derived === null ? undefined : { selection, decimalOdds: derived };
}

/** F1 判断凭证：一次选择一个市场里的一个结果，冻结当下倍率快照提交。
 *  一人一注：每个盘口只能提交一次判断，已投的盘口只等待结算。 */
export function F1PredictionSlip({ roomId, detail, interactive, onRefresh }: {
  roomId: string;
  detail: F1SessionDetailView;
  interactive: boolean;
  onRefresh: () => void;
}) {
  const markets = useMemo(() => {
    // 服务端只下发该场次应开放的盘口；白名单再兜一层（PODIUM/H2H 已下架）。
    const order: F1MarketKind[] = ["WINNER", "POLE", "EXACT_PODIUM"];
    return [...detail.markets]
      .filter((market) => order.includes(market.kind))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [detail.markets]);

  const [marketId, setMarketId] = useState<string>();
  const [selection, setSelection] = useState<string>();
  const [stake, setStake] = useState("1000");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  // 一人一注：已投盘口集合（marketId）。挂载时从服务端恢复，提交成功后就地追加。
  const [placed, setPlaced] = useState<ReadonlySet<string>>(new Set());

  const eventKey = `f1:${detail.session.id}`;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets/mine?fixtureId=${encodeURIComponent(eventKey)}`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { data?: Array<{ marketId?: string; status?: string }> };
        if (!response.ok || !Array.isArray(result.data)) return;
        setPlaced(new Set(result.data.filter((ticket) => ticket?.status === "PENDING").map((ticket) => String(ticket.marketId))));
      } catch { /* 已投态仅是展示；服务端始终强制一人一注 */ }
    })();
    return () => controller.abort();
  }, [roomId, eventKey]);

  // 默认聚焦到还没投过的盘口，投满后停在第一个。
  const active = markets.find((market) => market.id === marketId)
    ?? markets.find((market) => !placed.has(market.id))
    ?? markets[0];
  const activePlaced = active !== undefined && placed.has(active.id);
  const outcome = resolveOutcome(active, selection);
  const predictable = sessionPredictable(detail.session) && interactive;
  // 7.3a：离线禁提交；7.3b：离线仍可继续构建判断（存为本地草稿），只有提交被禁。
  const online = useOnlineStatus();
  const closed = !predictable || !active || active.status !== "OPEN" || activePlaced;
  const unavailable = closed || !online;

  // 7.3b —— 离线草稿：与足球 Slip 同一纪律（保存/恢复/重新验证/永不自动提交）。
  const [draft, setDraft] = useState<OfflineDraft | null>(null);
  const [draftVerdict, setDraftVerdict] = useState<DraftVerdict | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (online || !active || !outcome || !stake) return;
    saveOfflineDraft({ v: 1, roomId, eventKey, marketId: active.id, marketVersion: active.version, selection: outcome.selection, decimalOdds: outcome.decimalOdds, stakePoints: stake, savedAt: new Date().toISOString() });
  }, [online, active, outcome, stake, roomId, eventKey]);

  useEffect(() => {
    if (!online || restoredRef.current) return;
    restoredRef.current = true;
    // 微任务回调里恢复：localStorage 是外部系统，且避免 effect 内同步 setState 级联渲染。
    queueMicrotask(() => {
      const stored = loadOfflineDraft(roomId, eventKey);
      if (!stored) return;
      const target = markets.find((market) => market.id === stored.marketId);
      const currentOdds = resolveOutcome(target, stored.selection)?.decimalOdds;
      const verdict = revalidateDraft(stored, {
        open: sessionPredictable(detail.session) && interactive && target?.status === "OPEN",
        marketId: target?.id,
        marketVersion: target?.version,
        decimalOdds: currentOdds,
      });
      if (verdict === "UNCHANGED" && target) {
        setMarketId(stored.marketId);
        setSelection(stored.selection);
        setStake(stored.stakePoints);
      }
      setDraft(stored);
      setDraftVerdict(verdict);
    });
  }, [online, roomId, eventKey, markets, detail.session, interactive]);

  function clearDraft() {
    discardOfflineDraft(roomId, eventKey);
    setDraft(null);
    setDraftVerdict(null);
  }

  const projected = useMemo(() => {
    const amount = Number(stake), value = Number(outcome?.decimalOdds);
    return outcome && Number.isFinite(amount * value) ? formatPoints((amount * value).toFixed(2)) : "—";
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
        // 服务端说这个盘口已有判断：同步已投态，界面切到等待结算。
        if (code === "MARKET_TICKET_EXISTS" && active) setPlaced((previous) => new Set(previous).add(active.id));
        setError(ticketErrors[code] || result.error?.message || "提交失败，本次积分未发生变化。");
        return;
      }
      setReceipt(result.data?.ticketId || "已记录");
      setPlaced((previous) => new Set(previous).add(active.id));
      // 选中态已被消费：清掉它，避免之后离线时把已提交的判断又存成草稿。
      setSelection(undefined);
      clearDraft();
    } catch { setError("网络连接失败。系统不会离线排队，本次积分未发生变化。"); }
    finally { setPending(false); }
  }

  if (!markets.length) {
    return <section className="surface p-5"><h3 className="display text-xl font-bold">F1 判断</h3><p className="mt-2 text-sm text-[var(--muted)]">本场次还没有开放市场。管理员发布倍率后即可提交判断。</p></section>;
  }

  return (
    <form onSubmit={submit} className="pulse-slip surface space-y-4 p-4 sm:p-5" aria-label="F1 判断凭证" data-pulse-reveal>
      <header className="pulse-slip__head">
        <div><p className="pd-eyebrow">SECTOR 01 / PREDICTION SLIP</p><h3 className="kinetic text-3xl">提交判断</h3></div>
        <p className="pulse-slip__version">ODDS VERSION <span className="tabular">{active?.version}</span></p>
      </header>

      <div role="tablist" aria-label="选择市场" className="flex flex-wrap gap-2">
        {markets.map((market) => (
          <button key={market.id} type="button" role="tab" aria-selected={market.id === active?.id}
            onClick={() => { setMarketId(market.id); setSelection(undefined); setError(""); setReceipt(""); }}
            className={`min-h-10 rounded-full border-2 px-4 text-sm font-bold transition ${market.id === active?.id ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}>
            {MARKET_KIND_LABELS[market.kind]}{placed.has(market.id) ? " ✓已投" : ""}
          </button>
        ))}
      </div>

      {activePlaced
        ? <StatusMessage tone="info" title={`${active ? MARKET_KIND_LABELS[active.kind] : ""}已提交判断`}>每个盘口只能提交一次判断，积分已冻结；结果确认后自动结算，无需任何操作。</StatusMessage>
        : <>
          {/* key 按市场重挂：切市场/提交后组合器的分步选择从头开始 */}
          {active && <OutcomePicker key={`${active.id}:${receipt}`} market={active} drivers={detail.drivers} selection={selection} disabled={closed || pending} onSelect={(value) => { setSelection(value); setError(""); setReceipt(""); }} />}

          <div>
            <label htmlFor={`f1-stake-${detail.session.id}`} className="mb-2 block text-sm font-bold">投入积分</label>
            <input id={`f1-stake-${detail.session.id}`} disabled={closed || pending} type="number" inputMode="numeric" min="1" max="20000" step="1" required value={stake} onChange={(event) => setStake(event.target.value)} className="min-h-12 w-full rounded-lg border border-[var(--line)] bg-white px-3 tabular" />
            <div className="mt-2 flex flex-wrap gap-2">{["500", "1000", "2000"].map((value) => (
              <button key={value} disabled={closed || pending} type="button" onClick={() => setStake(value)} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-bold transition hover:border-[var(--field)] hover:text-[var(--field)]">{Number(value).toLocaleString()}</button>
            ))}</div>
          </div>

          <div className={`pulse-confirm text-sm ${outcome ? "is-armed" : ""}`}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[var(--muted)]">预计返还（含投入）</span>
              {outcome && <span className="pulse-confirm__lock">已锁定 {outcome.decimalOdds}x</span>}
            </span>
            <strong key={`${outcome?.selection ?? "none"}-${projected}`} className="pulse-confirm__value tabular">{projected}</strong>
          </div>
        </>}
      {draft && draftVerdict && <StatusMessage tone={draftVerdict === "UNCHANGED" ? "info" : "error"} title={draftVerdict === "UNCHANGED" ? "已恢复离线草稿" : "离线草稿需要处理"}>
        <span className="block">
          {draftVerdict === "UNCHANGED" && "离线时保存的判断已恢复。系统不会自动提交，请确认最新倍率后手动提交。"}
          {draftVerdict === "ODDS_CHANGED" && `离线期间积分倍率已变化（草稿倍率 ${draft.decimalOdds}），请按最新倍率重新选择，或丢弃这份草稿。`}
          {draftVerdict === "MARKET_CHANGED" && "离线期间市场已更换，这份草稿无法提交，请重新选择或丢弃。"}
          {draftVerdict === "EVENT_CLOSED" && "本场次已封盘，这份离线草稿无法提交，请丢弃。"}
        </span>
        <button type="button" onClick={clearDraft} className="mt-2 inline-flex min-h-8 items-center rounded-full border border-[var(--line)] bg-white px-3 text-xs font-bold text-[var(--ink)] transition hover:border-[var(--field)] hover:text-[var(--field)]">丢弃草稿</button>
      </StatusMessage>}
      {error && <StatusMessage tone="error" title="未提交">{error}</StatusMessage>}
      {receipt && <div className="pulse-stamp"><StatusMessage tone="success" title="判断已记录">票号：<span className="tabular">{receipt}</span></StatusMessage></div>}
      {!activePlaced && <button disabled={unavailable || pending || !outcome || !stake} className={`inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 ${outcome && !unavailable ? "pulse-submit-armed" : ""}`}>
        {pending ? "正在复核倍率与封盘状态…" : !online ? "离线中，提交已禁用" : unavailable ? "当前不可提交" : "确认最新倍率并提交"}
      </button>}
      <p className="text-xs leading-5 text-[var(--muted)]">投入必须为整数，单张上限 20,000 分。每个盘口只能提交一次判断，提交后等待结算。服务端将复核封盘时间与倍率版本；失败时不冻结积分。{markets.some((market) => market.kind === "EXACT_PODIUM") ? "领奖台之争按 P1→P2→P3 顺序判定。" : ""}</p>
    </form>
  );
}

function OutcomePicker({ market, drivers, selection, disabled, onSelect }: {
  market: F1MarketView;
  drivers: F1DriverView[];
  selection?: string;
  disabled: boolean;
  // undefined = 撤销选择（组合器凑不满三位时解除已锁定的组合）
  onSelect: (selection?: string) => void;
}) {
  const driverIndex = useMemo(() => new Map(drivers.map((driver) => [driver.code, driver])), [drivers]);
  const buttonClass = (selected: boolean) =>
    `pulse-pick rounded-lg border-2 px-2 py-2 text-left text-sm font-bold transition ${selected ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`;

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
              <span className="tabular text-xs font-black">{outcome.decimalOdds}</span>
            </span>
            {/* 选中态不做透明度弱化：白字压在品牌红上，opacity-80 会跌破 4.5:1 对比度 */}
            {driver && <span className={`mt-0.5 block truncate text-[10px] font-normal ${selection === outcome.selection ? "" : "text-[var(--muted)]"}`}>{driver.name}</span>}
          </button>;
        })}
      </div>
    </fieldset>;
  }

  if (market.kind === "EXACT_PODIUM") {
    return <ExactPodiumComposer market={market} drivers={drivers} driverIndex={driverIndex} selection={selection} disabled={disabled} onSelect={onSelect} buttonClass={buttonClass} />;
  }

  // PODIUM 与 H2H 已下架，读层不再返回；未知类型不渲染任何可选项。
  return null;
}

const PODIUM_SLOT_LABELS = ["P1 冠军", "P2 亚军", "P3 季军"] as const;

/** 领奖台之争：一张全车手网格，按点击顺序落到 P1 → P2 → P3（选过的车手自动锁定，
 *  即「选完 P1 后 P2 名单自动过滤」）。点顶部槽位可单独撤掉重选；凑满三位即时给出
 *  组合倍率。组合倍率由市场里每位车手的基础倍率经共享域公式推导（与服务端一致）；
 *  旧版枚举 POD3 组合的快照走直查路径。 */
function ExactPodiumComposer({ market, drivers, driverIndex, selection, disabled, onSelect, buttonClass }: {
  market: F1MarketView;
  drivers: F1DriverView[];
  driverIndex: Map<string, F1DriverView>;
  selection?: string;
  disabled: boolean;
  onSelect: (selection?: string) => void;
  buttonClass: (selected: boolean) => string;
}) {
  const { baseByCode, oddsByCombo } = useMemo(() => {
    const base = new Map<string, string>();
    const byCombo = new Map<string, string>();
    for (const outcome of market.outcomes) {
      const driver = /^DRV:([A-Z0-9]{2,4})$/.exec(outcome.selection);
      if (driver?.[1]) { base.set(driver[1], outcome.decimalOdds); continue; }
      if (POD3_PATTERN.test(outcome.selection)) byCombo.set(outcome.selection, outcome.decimalOdds);
    }
    return { baseByCode: base, oddsByCombo: byCombo };
  }, [market.outcomes]);

  // 候选保持积分榜顺序（detail.drivers 已按赛季积分排序）；旧快照没有基础行时
  // 回退到组合里出现过的车手。
  const candidates = useMemo(() => {
    if (baseByCode.size > 0) return drivers.filter((driver) => baseByCode.has(driver.code));
    const seen = new Set<string>();
    for (const combo of oddsByCombo.keys()) {
      const parsed = POD3_PATTERN.exec(combo);
      if (parsed) for (const code of [parsed[1], parsed[2], parsed[3]]) seen.add(code);
    }
    return drivers.filter((driver) => seen.has(driver.code));
  }, [baseByCode, oddsByCombo, drivers]);

  const parsedSelection = selection ? POD3_PATTERN.exec(selection) : null;
  const [picks, setPicks] = useState<string[]>(
    parsedSelection?.[1] && parsedSelection[2] && parsedSelection[3]
      ? [parsedSelection[1], parsedSelection[2], parsedSelection[3]]
      : [],
  );

  function comboOddsOf(order: readonly string[]): string | undefined {
    if (order.length !== 3) return undefined;
    const direct = oddsByCombo.get(`POD3:${order[0]}-${order[1]}-${order[2]}`);
    if (direct) return direct;
    const base = order.map((code) => baseByCode.get(code));
    if (base[0] === undefined || base[1] === undefined || base[2] === undefined) return undefined;
    return exactPodiumComboOdds([base[0], base[1], base[2]]) ?? undefined;
  }

  function commit(next: string[]) {
    setPicks(next);
    onSelect(next.length === 3 && comboOddsOf(next) ? `POD3:${next[0]}-${next[1]}-${next[2]}` : undefined);
  }

  function toggle(code: string) {
    if (picks.includes(code)) commit(picks.filter((picked) => picked !== code));
    else if (picks.length < 3) commit([...picks, code]);
  }

  const comboOdds = comboOddsOf(picks);
  const complete = picks.length === 3;

  return <fieldset disabled={disabled}>
    <legend className="mb-2 text-sm font-bold">按顺序点选前三位车手（P1 → P2 → P3，顺序判定）</legend>

    {/* 槽位摘要：点已落座的槽位可单独撤掉该位次，后面的自动前移。 */}
    <div className="flex flex-wrap gap-2" role="group" aria-label="已选前三">
      {PODIUM_SLOT_LABELS.map((label, slot) => {
        const code = picks[slot];
        return code
          ? <button key={label} type="button" onClick={() => toggle(code)}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border-2 border-[var(--field)] bg-[var(--field)] px-3 text-sm font-bold text-white transition hover:brightness-95"
              aria-label={`${label} ${code}，点击撤销`}>
              <span className="text-[10px] opacity-90">{label}</span><span className="tabular">{code}</span><span aria-hidden>×</span>
            </button>
          : <span key={label} className="inline-flex min-h-9 items-center gap-2 rounded-full border-2 border-dashed border-[var(--line)] px-3 text-sm font-bold text-[var(--muted)]">
              <span className="text-[10px]">{label}</span><span>待选</span>
            </span>;
      })}
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="全部车手">
      {candidates.map((driver) => {
        const slot = picks.indexOf(driver.code);
        const picked = slot >= 0;
        const full = !picked && complete;
        return <button key={driver.code} type="button" aria-pressed={picked} disabled={full}
          onClick={() => toggle(driver.code)}
          className={`${buttonClass(picked)} disabled:cursor-not-allowed disabled:opacity-35`}>
          <span className="flex items-center gap-2">
            <i aria-hidden className="h-4 w-1 shrink-0 rounded-sm" style={{ background: driver.color ?? "var(--muted)" }} />
            <span className="min-w-0 flex-1 truncate tabular">{driver.code}</span>
            {picked && <span className="tabular text-xs font-black">P{slot + 1}</span>}
          </span>
          <span className={`mt-0.5 block truncate text-[10px] font-normal ${picked ? "" : "text-[var(--muted)]"}`}>{driverIndex.get(driver.code)?.name ?? driver.name}</span>
        </button>;
      })}
    </div>

    <p className="mt-3 text-sm" aria-live="polite">
      {complete
        ? comboOdds
          ? <><span className="tabular font-bold">{picks[0]} → {picks[1]} → {picks[2]}</span><span className="tabular ml-2 text-xs font-black">{comboOdds}x</span></>
          : <span className="font-bold text-[var(--pulse-red-deep)]">该组合暂未开放，请换一位车手。</span>
        : <span className="text-[var(--muted)]">还差 {3 - picks.length} 位：按你判断的完赛顺序点选，凑满三位即锁定组合倍率。</span>}
    </p>
  </fieldset>;
}
