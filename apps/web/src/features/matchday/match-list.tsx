"use client";

import { useEffect, useState } from "react";
import { MatchCard } from "@/components/match-card";
import { SoccerBall } from "@/components/football";
import { PredictionSlip } from "./prediction-slip";
import {
  datasetNotice,
  filterMatches,
  groupMatches,
  matchAvailability,
  matchDateKey,
  paginateMatches,
  summarizeMatches,
} from "./match-filters";
import { normalizeMatch, type ApiEnvelope, type ApiFailure, type MatchView } from "./types";

const MATCH_BATCH_SIZE = 24;

export function MatchList({ roomId, interactive = false }: { roomId?: string; interactive?: boolean }) {
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [competition, setCompetition] = useState("");
  const [date, setDate] = useState("");
  const [visibleCount, setVisibleCount] = useState(MATCH_BATCH_SIZE);

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
              .sort((left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime())
          : [];
        setMatches(normalized);
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
  if (!matches.length) return <Empty title="目前没有可显示的比赛" text="同步完成后，目标赛事会出现在这里。" />;

  const competitions = [...new Set(matches.map((match) => match.competitionName))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const dates = [...new Set(matches.map((match) => matchDateKey(match)).filter(Boolean))].sort();
  const filtered = filterMatches(matches, { competition, date });
  const page = paginateMatches(filtered, visibleCount);
  const groups = groupMatches(page.items);
  const summary = summarizeMatches(filtered);
  const notice = datasetNotice(matches);
  const newestDataAsOf = matches
    .map((match) => match.dataAsOf)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const resetBatch = () => setVisibleCount(MATCH_BATCH_SIZE);
  const clearFilters = () => {
    setCompetition("");
    setDate("");
    resetBatch();
  };

  return <div>
    <section className="night mb-6 flex items-start gap-3 rounded-xl px-5 py-4" aria-label="当前比赛数据说明">
      <SoccerBall className="mt-0.5 size-5 shrink-0 text-[var(--volt)]" />
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--volt)]">当前赛程 · 2026 世界杯</p>
        <p className="mt-1 text-sm leading-6 text-white/70">仅展示正在进行和未来比赛；球队、赛事名称使用中文。开球时间与赛果来自 OpenLigaDB，显示的 3.00 为平台固定虚拟积分倍率，不是博彩公司赔率。</p>
      </div>
    </section>
    {notice && <section className="mb-6 rounded-xl border-l-4 border-[var(--amber)] bg-[#fff5d6] p-4" aria-label={notice.title}>
      <strong>{notice.title}</strong>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{notice.detail}</p>
    </section>}
    <section className="surface mb-8 rounded-xl p-4" aria-label="比赛筛选和数据状态">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">联赛
          <select value={competition} onChange={(event) => { setCompetition(event.target.value); resetBatch(); }} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-medium normal-case text-[var(--ink)]">
            <option value="">全部联赛（{competitions.length}）</option>
            {competitions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">比赛日期
          <select value={date} onChange={(event) => { setDate(event.target.value); resetBatch(); }} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm font-medium normal-case text-[var(--ink)]">
            <option value="">全部日期（{dates.length}）</option>
            {dates.map((value) => <option key={value} value={value}>{formatDate(value)}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white transition hover:bg-[var(--field)]"><SoccerBall className="size-4" />刷新数据</button>
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
        {groups.map((dateGroup) => <section key={dateGroup.date} aria-labelledby={`match-date-${dateGroup.date}`}>
          <header className="relative mb-6 flex items-end justify-between gap-4 border-b-2 border-[var(--ink)] pb-3">
            <div className="min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--field)]">Matchday</span>
              <h2 id={`match-date-${dateGroup.date}`} className="kinetic mt-1 text-[clamp(1.75rem,5vw,3rem)]">{dateGroup.date === "unknown" ? "日期待确认" : formatDate(dateGroup.date)}</h2>
            </div>
            <span className="league-pill shrink-0">{dateGroup.competitions.reduce((total, group) => total + group.matches.length, 0)} 场</span>
            <span className="absolute -bottom-[2px] left-0 h-[3px] w-24 bg-[var(--volt-deep)]" aria-hidden="true" />
          </header>
          <div className="space-y-8">
            {dateGroup.competitions.map((competitionGroup) => <section key={competitionGroup.name} aria-label={competitionGroup.name}>
              <div className="mb-3 flex items-center gap-3">
                <span className="league-pill"><SoccerBall className="size-3.5" />{competitionGroup.name}</span>
                <span className="text-xs text-[var(--muted)]">{competitionGroup.matches.length} 场</span>
                <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {competitionGroup.matches.map((match) => {
                  const predictable = matchAvailability(match).predictable;
                  return <MatchCard
                    key={match.id}
                    match={match}
                    action={interactive && roomId && predictable ? <PredictionSlip roomId={roomId} match={match} /> : undefined}
                  />;
                })}
              </div>
            </section>)}
          </div>
        </section>)}
      </div>
      {page.hasMore && <div className="mt-10 border-t rule pt-6 text-center">
        <button type="button" onClick={() => setVisibleCount((count) => count + MATCH_BATCH_SIZE)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--ink)] px-5 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white sm:w-auto">
          <SoccerBall className="size-4" />再显示 {Math.min(MATCH_BATCH_SIZE, page.remaining)} 场
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

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <section className="surface rounded-xl p-10 text-center">
    <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-[var(--field)] text-white"><SoccerBall className="size-7" /></span>
    <p className="kinetic text-2xl">{title}</p>
    <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">{text}</p>
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </section>;
}
