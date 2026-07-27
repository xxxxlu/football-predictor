"use client";

import { useEffect, useState } from "react";
import { MatchCard } from "@/components/match-card";
import { SportGlyph } from "@/components/pulse";
import { PredictionSlip } from "./prediction-slip";
import {
  datasetNotice,
  filterMatches,
  freshnessNotice,
  groupMatches,
  matchAvailability,
  matchDateKey,
  paginateMatches,
  sortMatchesForDisplay,
  summarizeMatches,
  type MatchStatusFilter,
} from "./match-filters";
import { normalizeFreshness, normalizeMatch, type ApiEnvelope, type ApiFailure, type FreshnessMeta, type MatchView } from "./types";

const MATCH_BATCH_SIZE = 24;

export function MatchList({ roomId, interactive = false, advanced = false }: { roomId?: string; interactive?: boolean; advanced?: boolean }) {
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [freshness, setFreshness] = useState<FreshnessMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [competition, setCompetition] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<MatchStatusFilter>("ALL");
  const [visibleCount, setVisibleCount] = useState(MATCH_BATCH_SIZE);
  // 一人一注：房间里已投过的盘口。一屏可以有几十张卡片，所以在列表层拉一次，
  // 再分发给各张判断凭证，而不是每张卡片各拉一次。
  const [placedMarketIds, setPlacedMarketIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!roomId || !interactive) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/tickets/mine`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { data?: Array<{ marketId?: string; status?: string }> };
        if (!response.ok || !Array.isArray(result.data)) return;
        setPlacedMarketIds(new Set(result.data.filter((ticket) => ticket?.status === "PENDING").map((ticket) => String(ticket.marketId))));
      } catch { /* 已投态只是展示；服务端始终强制一人一注 */ }
    })();
    return () => controller.abort();
  }, [roomId, interactive, retry]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : "";
        const response = await fetch(`/api/v1/matches${query}`, {
          credentials: "same-origin",
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure;
        if (!response.ok) throw new Error(result.error?.message || "比赛数据暂不可用");
        const normalized = Array.isArray(result.data)
          ? result.data
              .map((item) => normalizeMatch(item as Parameters<typeof normalizeMatch>[0]))
              .filter((item): item is MatchView => item !== null)
          : [];
        setMatches(normalized);
        setFreshness(normalizeFreshness(result.meta?.freshness));
        setVisibleCount(MATCH_BATCH_SIZE);
        setError("");
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "比赛数据暂不可用");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [roomId, retry]);

  if (loading) {
    return <div aria-live="polite" aria-busy="true" className="grid gap-4 sm:grid-cols-2">
      {[1, 2, 3, 4].map((number) => <div key={number} className="pitch-skeleton h-36 rounded-xl" />)}
      <span className="sr-only">正在加载比赛</span>
    </div>;
  }
  if (error) {
    return <Empty title="暂时无法取得比赛" text={error} action={
      <button onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1); }} className={BTN_OUTLINE}>重试</button>
    } />;
  }
  if (!matches.length) {
    const emptyNotice = freshnessNotice({ freshness, matches, now: new Date() });
    const nextLine = emptyNotice?.nextMatch
      ? `下一场比赛：${formatKickoff(emptyNotice.nextMatch.kickoffAt)}${emptyNotice.nextMatch.competitionName ? ` · ${emptyNotice.nextMatch.competitionName}` : ""}。`
      : "";
    return <Empty title="目前没有可显示的比赛" text={`同步完成后，目标赛事会出现在这里。${nextLine}`} />;
  }

  const competitions = [...new Set(matches.map((match) => match.competitionName))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const dates = [...new Set(matches.map((match) => matchDateKey(match)).filter(Boolean))].sort();
  const filtered = sortMatchesForDisplay(filterMatches(matches, { competition, date, status }));
  const page = paginateMatches(filtered, visibleCount);
  const groups = groupMatches(page.items);
  const summary = summarizeMatches(filtered);
  const notice = datasetNotice(matches);
  const supplierNotice = freshnessNotice({ freshness, matches, now: new Date() });
  const newestDataAsOf = matches
    .map((match) => match.dataAsOf)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const resetBatch = () => setVisibleCount(MATCH_BATCH_SIZE);
  const clearFilters = () => {
    setCompetition("");
    setDate("");
    setStatus("ALL");
    resetBatch();
  };

  // min-w-0: rendered as a grid item; the league-chip rail scrolls internally
  // (overflow-x-auto) instead of widening the whole page on narrow screens.
  return <div className="min-w-0">
    <section className="night mb-6 flex items-start gap-3 rounded-xl px-5 py-4" aria-label="当前比赛数据说明" data-pulse-reveal>
      <SportGlyph sport="FOOTBALL" className="mt-0.5 size-5 shrink-0 text-[var(--pulse-red)]" />
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-white/70">足球数据 · 产品缓存</p>
        <p className="mt-1 text-sm leading-6 text-white/70">比赛、开球时间与赛果只展示已配置供应商写入的真实缓存；当前没有未来可预测比赛时，只保留历史记录，不编造赛程或赔率。平台固定倍率会明确标注为虚拟积分规则。</p>
        {supplierNotice && <div className="mt-2 space-y-1 text-sm leading-6">
          {supplierNotice.lastCapturedAt && <p className="text-white/70">最新缓存时间 {new Date(supplierNotice.lastCapturedAt).toLocaleString("zh-CN")}</p>}
          {supplierNotice.nextMatch && <p className="text-white/70">当前没有进行中的赛事，下一场比赛：{formatKickoff(supplierNotice.nextMatch.kickoffAt)}{supplierNotice.nextMatch.competitionName ? ` · ${supplierNotice.nextMatch.competitionName}` : ""}</p>}
          {supplierNotice.stale && <p className="font-bold text-[var(--amber)]">供应商数据已超过 48 小时未更新</p>}
        </div>}
      </div>
    </section>
    {notice && <section className="mb-6 rounded-xl border-l-4 border-[var(--amber)] bg-[#fff5d6] p-4" aria-label={notice.title}>
      <strong>{notice.title}</strong>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{notice.detail}</p>
    </section>}
    <section className="surface mb-8 rounded-xl p-4" aria-label="比赛筛选和数据状态">
      <fieldset className="mb-4">
        <legend className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">比赛状态</legend>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:inline-grid sm:min-w-[24rem]">
          {([["ALL", "全部"], ["PREDICTABLE", "可预测"], ["FINISHED", "已结束"]] as const).map(([value, label]) => <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => { setStatus(value); resetBatch(); }}
            className={`min-h-10 rounded-full border-2 px-4 text-sm font-bold transition ${status === value ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--ink)]"}`}
          >{label}</button>)}
        </div>
      </fieldset>
      {/* fieldset defaults to min-width:min-content — min-w-0 lets the chip rail scroll */}
      <fieldset className="mb-4 min-w-0">
        <legend className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">联赛分类</legend>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="按联赛筛选比赛">
          {[{ value: "", label: `全部联赛（${competitions.length}）` }, ...competitions.map((name) => ({ value: name, label: name }))].map((option) => <button
            key={option.value || "all"}
            type="button"
            aria-pressed={competition === option.value}
            onClick={() => { setCompetition(option.value); resetBatch(); }}
            className={`min-h-10 shrink-0 rounded-full border-2 px-4 text-sm font-bold transition ${competition === option.value ? "border-[var(--field)] bg-[var(--field)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--field)]"}`}
          >{option.label}</button>)}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">比赛日期
          <select value={date} onChange={(event) => { setDate(event.target.value); resetBatch(); }} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-medium normal-case text-[var(--ink)]">
            <option value="">全部日期（{dates.length}）</option>
            {dates.map((value) => <option key={value} value={value}>{formatDate(value)}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white transition hover:bg-[var(--field)]">刷新数据</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t rule pt-3 text-xs text-[var(--muted)]" aria-live="polite">
        <strong className="text-[var(--ink)]">筛选命中 {summary.total} / {matches.length} 场</strong>
        <span>可预测 {summary.open}</span>
        <span>已结束 {summary.finished}</span>
        <span className={summary.stale ? "text-[var(--amber)]" : ""}>最后有效快照 {summary.stale}</span>
        <span className="basis-full sm:ml-auto sm:basis-auto">数据截至 {newestDataAsOf ? new Date(newestDataAsOf).toLocaleString("zh-CN") : "未知"}</span>
      </div>
    </section>

    {page.total ? <>
      <p className="mb-5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]" aria-live="polite">当前展示 {page.shown} / {page.total} 场</p>
      <div className="space-y-12">
        {groups.map((competitionGroup, competitionIndex) => <section key={competitionGroup.name} aria-labelledby={`competition-${competitionIndex}`}>
          <header className="pulse-comp-head relative mb-6 flex items-end justify-between gap-4 border-b-2 border-[var(--ink)] pb-3" data-pulse-reveal>
            <div className="min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--field)]">Competition / {String(competitionIndex + 1).padStart(2, "0")}</span>
              <h2 id={`competition-${competitionIndex}`} className="kinetic mt-1 text-[clamp(1.75rem,5vw,3rem)]">{competitionGroup.name}</h2>
            </div>
            <span className="league-pill shrink-0">{competitionGroup.dates.reduce((total, group) => total + group.matches.length, 0)} 场</span>
            <span className="pulse-comp-head__bar absolute -bottom-[2px] left-0 h-[3px] w-24 bg-[var(--pulse-red)]" aria-hidden="true" />
          </header>
          <div className="space-y-8">
            {competitionGroup.dates.map((dateGroup) => <section key={dateGroup.date} aria-label={dateGroup.date === "unknown" ? "日期待确认" : formatDate(dateGroup.date)}>
              <div className="mb-3 flex items-center gap-3" data-pulse-reveal>
                <span className="league-pill">{dateGroup.date === "unknown" ? "日期待确认" : formatDate(dateGroup.date)}</span>
                <span className="text-xs text-[var(--muted)]">{dateGroup.matches.length} 场</span>
                <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {dateGroup.matches.map((match, matchIndex) => {
                  const predictable = matchAvailability(match).predictable;
                  return <div key={match.id} className="grid" data-pulse-reveal style={{ "--pulse-reveal-delay": `${Math.min(matchIndex, 5) * 70}ms` } as React.CSSProperties}>
                    <MatchCard
                      match={match}
                      action={interactive && roomId && predictable ? <PredictionSlip roomId={roomId} match={match} advanced={advanced} placedMarketIds={placedMarketIds} /> : undefined}
                    />
                  </div>;
                })}
              </div>
            </section>)}
          </div>
        </section>)}
      </div>
      {page.hasMore && <div className="mt-10 border-t rule pt-6 text-center">
        <button type="button" onClick={() => setVisibleCount((count) => count + MATCH_BATCH_SIZE)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--ink)] px-5 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white sm:w-auto">
          再显示 {Math.min(MATCH_BATCH_SIZE, page.remaining)} 场
        </button>
        <p className="mt-2 text-xs text-[var(--muted)]">还有 {page.remaining} 场未展示</p>
      </div>}
    </> : <Empty title="没有符合筛选的比赛" text="请更换联赛或日期筛选条件。" action={
      <button type="button" onClick={clearFilters} className={BTN_OUTLINE}>清除筛选</button>
    } />}
  </div>;
}

const BTN_OUTLINE = "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white";

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}

function formatKickoff(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <section className="surface rounded-xl p-10 text-center">
    <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-[var(--pulse-carbon)] text-white"><SportGlyph sport="FOOTBALL" className="size-7" /></span>
    <p className="kinetic text-2xl">{title}</p>
    <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">{text}</p>
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </section>;
}
