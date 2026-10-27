"use client";

import Link from "next/link";
import { useState } from "react";
import type { MatchView, OddsSelection } from "../features/matchday/types";
import type { LiveFeedItem } from "@pulse/domain";
import { matchAvailability } from "../features/matchday/match-filters";
import { StatusBanner } from "./status-banner";
import { TeamCrest } from "./football";
import { SportGlyph } from "./pulse";
import { BottomSheet } from "./bottom-sheet";
import { useOddsFormat } from "./odds-format-provider";
import { ProInsightsModal } from "./pro-insights-modal";

export type MatchCardActionRender = (props: {
  initialSelection?: OddsSelection;
  onClose: () => void;
}) => React.ReactNode;

export function MatchCard({
  match,
  liveItem,
  action,
}: {
  match: MatchView;
  liveItem?: LiveFeedItem;
  action?: MatchCardActionRender | React.ReactNode;
}) {
  const { displayOdds } = useOddsFormat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [selectedOdds, setSelectedOdds] = useState<OddsSelection>();
  const kickoff = new Date(match.kickoffAt);
  const availability = matchAvailability(match);
  const isLive = liveItem?.status === "LIVE" || (liveItem?.minute !== undefined && liveItem?.minute > 0 && liveItem?.status !== "FINISHED");
  const recentGoals = liveItem?.recentEvents?.filter((e) => e.type === "GOAL") ?? [];
  const hasGoal = recentGoals.length > 0;
  const odds: Array<{ label: string; value: string; selection: OddsSelection }> = match.market
    ? [
        { label: "主胜", value: displayOdds(match.market.home), selection: "HOME" },
        { label: "平局", value: displayOdds(match.market.draw), selection: "DRAW" },
        { label: "客胜", value: displayOdds(match.market.away), selection: "AWAY" },
      ]
    : [];
  const statusTone = availability.predictable ? "text-[var(--field)]" : match.stale ? "text-[var(--amber)]" : "text-[var(--muted)]";
  const resultLabel = match.result
    ? match.result.homeScore > match.result.awayScore
      ? `${match.homeTeam}胜`
      : match.result.awayScore > match.result.homeScore
        ? `${match.awayTeam}胜`
        : "平局"
    : null;

  const handleOpenSlip = (selection?: OddsSelection) => {
    setSelectedOdds(selection);
    setDrawerOpen(true);
  };

  const handleCloseSlip = () => {
    setDrawerOpen(false);
  };

  const renderedAction = typeof action === "function"
    ? action({ initialSelection: selectedOdds, onClose: handleCloseSlip })
    : action;

  return (
    <article className="tilt-card interactive-card overflow-hidden rounded-2xl border border-white/10 bg-[#121418] text-white shadow-xl transition-all hover:border-[rgba(255,42,59,0.35)]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-4 py-3">
        <span className="league-pill min-w-0">
          <SportGlyph sport="FOOTBALL" className="size-3.5 shrink-0" />
          <span className="truncate">{match.competitionName}</span>
        </span>
        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
              </span>
              <span>LIVE {liveItem?.minute ? `${liveItem.minute}'` : ""}</span>
            </span>
          ) : (
            <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${statusTone}`}>
              {availability.predictable && <span className="pulse-dot" aria-hidden="true" />}
              {availability.label}
            </span>
          )}
        </div>
      </header>
      <div className="p-4 md:p-5">
        {hasGoal && (
          <div className="mb-3 animate-pulse rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
            ⚽ 进球速报：{recentGoals.map((g) => g.description || "进球！").join(" ")}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamCrest name={match.homeTeam} className="size-12 text-base md:size-14 md:text-lg" />
            <span className="display text-sm font-bold leading-tight md:text-base">{match.homeTeam}</span>
          </div>
          <div className="flex flex-col items-center gap-2 pt-1.5">
            {match.state === "FINISHED" ? match.result ? <div
              aria-label={`最终比分 ${match.homeTeam} ${match.result.homeScore} 比 ${match.result.awayScore} ${match.awayTeam}`}
              className="flex flex-col items-center gap-1 text-center"
            >
              <span className="tabular whitespace-nowrap text-2xl font-black text-[var(--ink)]">
                {match.result.homeScore}<span className="px-1 text-[var(--muted)]">:</span>{match.result.awayScore}
              </span>
              <strong className="whitespace-nowrap text-xs text-[var(--field)]">{resultLabel}</strong>
            </div> : <div className="flex flex-col items-center gap-1 text-center">
              <span className="vs-badge">FT</span>
              <strong className="whitespace-nowrap text-xs text-[var(--muted)]">赛果待确认</strong>
            </div> : isLive ? <div
              aria-label={`实时进行中 ${match.homeTeam} ${liveItem?.score.home ?? 0} 比 ${liveItem?.score.away ?? 0} ${match.awayTeam}`}
              className="flex flex-col items-center gap-1 text-center"
            >
              <span className="tabular whitespace-nowrap text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {liveItem?.score.home ?? 0}<span className="px-1 text-[var(--muted)]">:</span>{liveItem?.score.away ?? 0}
              </span>
              <strong className="whitespace-nowrap text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {liveItem?.minute ? `${liveItem.minute}' 比赛中` : "实时进行中"}
              </strong>
            </div> : <span className="vs-badge">VS</span>}
            <time dateTime={match.kickoffAt} className="tabular block max-w-[6.5rem] text-center text-[11px] font-bold leading-tight text-[var(--muted)]">
              {kickoff.toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <TeamCrest name={match.awayTeam} avoid={match.homeTeam} className="size-12 text-base md:size-14 md:text-lg" />
            <span className="display text-sm font-bold leading-tight md:text-base">{match.awayTeam}</span>
          </div>
        </div>
        {match.state !== "FINISHED" && odds.length > 0 && (
          <dl className="mt-5 grid grid-cols-3 gap-2" aria-label="虚拟积分倍率">
            {odds.map((odd) => {
              const trend = liveItem?.oddsMovement?.[odd.selection];
              return (
                <div
                  key={odd.label}
                  role={action ? "button" : undefined}
                  tabIndex={action ? 0 : undefined}
                  onClick={action ? () => handleOpenSlip(odd.selection) : undefined}
                  onKeyDown={action ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenSlip(odd.selection); } } : undefined}
                  className={`scoreboard-cell px-2 py-2 text-center transition-colors ${action ? "pressable-btn cursor-pointer hover:border-[var(--pulse-red)]" : ""}`}
                  title={action ? `点击选择【${odd.label}】并填写判断` : undefined}
                >
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{odd.label}</dt>
                  <dd className="tabular mt-0.5 flex items-center justify-center gap-1 text-lg font-black">
                    <span>{odd.value}</span>
                    {trend === "UP" && (
                      <span className="text-[10px] font-black text-emerald-500 animate-bounce" title="赔率上升" aria-label="赔率上升">
                        ▲
                      </span>
                    )}
                    {trend === "DOWN" && (
                      <span className="text-[10px] font-black text-[var(--pulse-red)] animate-bounce" title="赔率下降" aria-label="赔率下降">
                        ▼
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {match.stale && match.market && <div className="mt-4"><StatusBanner kind="stale" timestamp={match.dataAsOf} /></div>}
        {!match.stale && match.state === "CLOSED" && <div className="mt-4"><StatusBanner kind="closed" /></div>}
        {(!match.market || !match.stale) && ["PAUSED", "DATA_UNAVAILABLE"].includes(match.state) && <div className="mt-4"><StatusBanner kind="unavailable" /></div>}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Link href={`/matches/${encodeURIComponent(match.id)}`} className="link-arrow inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[var(--field)] hover:underline" aria-label={`查看 ${match.homeTeam} 对 ${match.awayTeam} 的阵容与详情`}>
            查看阵容与详情<span className="arrow">→</span>
          </Link>
          <button
            type="button"
            onClick={() => setInsightsOpen(true)}
            className="pressable-btn inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-400"
            title="查看 AI 胜率预测与 xG 预期进球"
          >
            <span>⚡</span>
            <span>PRO 分析</span>
          </button>
        </div>
        {action && (
          <div className="mt-4 pt-3 border-t rule">
            <button
              type="button"
              onClick={() => handleOpenSlip(undefined)}
              className="pressable-btn flex min-h-10 w-full items-center justify-between rounded-lg border border-[var(--field)]/30 bg-[var(--wash-brand-soft)] px-3.5 text-xs font-bold text-[var(--field)] transition hover:border-[var(--field)] hover:bg-[var(--wash-brand)]"
            >
              <span className="flex items-center gap-1.5">
                <SportGlyph sport="FOOTBALL" className="size-3.5" />
                <span>填写本场判断</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] opacity-80">
                <span>打开判断单</span>
                <span className="arrow">→</span>
              </span>
            </button>

            {/* Bottom Sheet for Mobile & Slide-Over Drawer for Desktop */}
            <BottomSheet
              isOpen={drawerOpen}
              onClose={handleCloseSlip}
              title={
                <div className="flex items-center gap-2">
                  <span className="league-pill">{match.competitionName}</span>
                  <span className="text-xs text-[var(--muted)]">赛事判断单</span>
                </div>
              }
              subtitle={`${match.homeTeam} VS ${match.awayTeam}`}
            >
              {renderedAction}
            </BottomSheet>
          </div>
        )}
        <ProInsightsModal
          match={match}
          isOpen={insightsOpen}
          onClose={() => setInsightsOpen(false)}
        />
      </div>
    </article>
  );
}
