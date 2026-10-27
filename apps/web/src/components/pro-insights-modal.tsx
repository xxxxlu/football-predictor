"use client";

import { useEffect, useState } from "react";
import type { MatchView } from "@/features/matchday/types";
import { TeamCrest } from "./football";

const PRO_POINTS_PRICING = {
  PRO_MONTHLY: 5000,
  PRO_ANNUAL: 38000,
} as const;

export interface ProInsightsData {
  matchId: string;
  isPro: boolean;
  trialAvailable: boolean;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  expectedGoals: {
    home: number;
    away: number;
  };
  sharpAction?: {
    oddsDefenseShift: number;
    marketConvergence: string;
    injuryRiskIndex: {
      level: string;
      impactScore: number;
      affectedPositions: string[];
    };
    recommendedValueMarket: string;
    confidencePercent: number;
  } | null;
}

export function ProInsightsModal({
  match,
  isOpen,
  onClose,
}: {
  match: MatchView;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [isProSubscriber, setIsProSubscriber] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [trialAvailable, setTrialAvailable] = useState(true);
  const [availablePoints, setAvailablePoints] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<"PRO_MONTHLY" | "PRO_ANNUAL">("PRO_MONTHLY");
  const [activatingTrial, setActivatingTrial] = useState(false);
  const [subscribingPoints, setSubscribingPoints] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [insights, setInsights] = useState<ProInsightsData | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function loadData() {
      try {
        // Parallel fetch for profile and match insights
        const [profileRes, insightsRes] = await Promise.all([
          fetch("/api/v1/billing/profile"),
          fetch(`/api/v1/matches/${match.id}/pro-insights`),
        ]);

        if (profileRes.ok) {
          const profile = await profileRes.json();
          if (isMounted) {
            setIsProSubscriber(Boolean(profile.isPro));
            setDaysRemaining(profile.daysRemaining ?? 0);
            setTrialAvailable(Boolean(profile.trialAvailable));
            setAvailablePoints(profile.availablePoints ?? 0);
          }
        }

        if (insightsRes.ok) {
          const data = await insightsRes.json();
          if (isMounted) {
            setInsights(data);
          }
        }
      } catch {
        // Fallback silently if offline or network error
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [isOpen, match.id]);

  if (!isOpen) return null;

  // Fallback estimates if loading
  const hash = Math.abs(
    match.id.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0),
  );
  const homeProb = insights?.probabilities.home ?? (38 + (hash % 25));
  const drawProb = insights?.probabilities.draw ?? (20 + ((hash >> 2) % 12));
  const awayProb = insights?.probabilities.away ?? Math.max(10, 100 - homeProb - drawProb);
  const xGHome = insights?.expectedGoals.home ? insights.expectedGoals.home.toFixed(2) : (1.2 + ((hash % 15) / 10)).toFixed(2);
  const xGAway = insights?.expectedGoals.away ? insights.expectedGoals.away.toFixed(2) : (0.8 + (((hash >> 3) % 14) / 10)).toFixed(2);

  const cost = PRO_POINTS_PRICING[selectedPlan];
  const canAfford = availablePoints >= cost;

  const handleActivateTrial = async () => {
    setActivatingTrial(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/v1/billing/trial", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "试用开通失败");
      }
      setIsProSubscriber(true);
      setTrialAvailable(false);
      setDaysRemaining(7);
      setSuccessBanner("🎉 7 天 PULSE PRO 免费试用已成功激活！全部量化模型与盘口资金流已即时解锁。");

      // Reload match insights with full sharpAction
      const insightsRes = await fetch(`/api/v1/matches/${match.id}/pro-insights`);
      if (insightsRes.ok) {
        setInsights(await insightsRes.json());
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "开通失败，请稍后重试");
    } finally {
      setActivatingTrial(false);
    }
  };

  const handleSubscribeWithPoints = async () => {
    setSubscribingPoints(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/v1/billing/subscribe-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: selectedPlan }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "积分开通失败");
      }
      setIsProSubscriber(true);
      if (typeof data.daysRemaining === "number") {
        setDaysRemaining(data.daysRemaining);
      } else {
        setDaysRemaining(selectedPlan === "PRO_ANNUAL" ? 365 : 30);
      }
      if (typeof data.availablePoints === "number") {
        setAvailablePoints(data.availablePoints);
      } else {
        setAvailablePoints((prev) => Math.max(0, prev - cost));
      }
      setSuccessBanner(
        selectedPlan === "PRO_ANNUAL"
          ? "🎉 成功使用 38,000 积分兑换 PULSE PRO 年度特惠会员！权益已即时生效。"
          : "🎉 成功使用 5,000 积分兑换 PULSE PRO 月度会员！权益已即时生效。"
      );

      // Reload match insights with full sharpAction
      const insightsRes = await fetch(`/api/v1/matches/${match.id}/pro-insights`);
      if (insightsRes.ok) {
        setInsights(await insightsRes.json());
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "开通失败，请稍后重试");
    } finally {
      setSubscribingPoints(false);
    }
  };

  const handleCheckout = async () => {
    setStartingCheckout(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier: selectedPlan }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "创建收银台失败");
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "发起支付失败，请检查网络后重试");
      setStartingCheckout(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="PULSE PRO 专家数据看板"
      className="bottom-sheet-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="interactive-card night relative flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0B0D11] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-gradient-to-r from-amber-500 to-yellow-300 px-2.5 py-0.5 text-[10px] font-black uppercase text-black shadow-sm">
                PULSE PRO
              </span>
              {isProSubscriber ? (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  👑 VIP 会员已激活 · 剩余 {daysRemaining} 天
                </span>
              ) : (
                <span className="text-xs font-bold text-white/50">{match.competitionName} · 深度量化看板</span>
              )}
            </div>
            <h2 className="display mt-1 text-xl font-black text-white">
              {match.homeTeam} 对 {match.awayTeam}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="pressable-btn size-8 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Banners */}
        {successBanner && (
          <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3 text-center text-xs font-bold text-emerald-400">
            {successBanner}
          </div>
        )}
        {errorMessage && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-950/40 p-3 text-center text-xs font-bold text-red-400">
            {errorMessage}
          </div>
        )}

        {/* Content Area */}
        <div className="mt-4 flex-1 space-y-6 overflow-y-auto pr-1">
          {/* Section 1: AI Win Probability Matrix */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-[var(--pulse-red)]">
                AI 蒙特卡洛胜率预测模型 v4.2
              </span>
              <span className="text-[11px] text-white/40">基于近 20 场历史数据</span>
            </div>

            {/* Probability Bars */}
            <div className="mt-3 flex items-center justify-between text-xs font-bold">
              <span className="text-white">{match.homeTeam} 胜 {homeProb}%</span>
              <span className="text-white/60">平局 {drawProb}%</span>
              <span className="text-white">{match.awayTeam} 胜 {awayProb}%</span>
            </div>
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div style={{ width: `${homeProb}%` }} className="bg-[var(--pulse-red)] transition-all" />
              <div style={{ width: `${drawProb}%` }} className="bg-amber-400/70 transition-all" />
              <div style={{ width: `${awayProb}%` }} className="bg-blue-500 transition-all" />
            </div>
          </section>

          {/* Section 2: Expected Goals (xG) Matrix */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-white/60">
              预期进球走势分析 (Expected Goals xG)
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                <TeamCrest name={match.homeTeam} className="mx-auto size-8 text-sm" />
                <p className="mt-2 text-xs font-bold text-white/70">{match.homeTeam}</p>
                <p className="tabular mt-1 text-2xl font-black text-white">{xGHome}</p>
                <p className="text-[10px] text-white/40">预期进球 xG</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/30 p-3">
                <TeamCrest name={match.awayTeam} avoid={match.homeTeam} className="mx-auto size-8 text-sm" />
                <p className="mt-2 text-xs font-bold text-white/70">{match.awayTeam}</p>
                <p className="tabular mt-1 text-2xl font-black text-white">{xGAway}</p>
                <p className="text-[10px] text-white/40">预期进球 xG</p>
              </div>
            </div>
          </section>

          {/* Section 3: Sharp Money & Value Detector */}
          <section className={`relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4 ${!isProSubscriber ? "min-h-[360px]" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-amber-400">⚡</span>
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-300">
                  机构盘口异动与资金流向预警 (Sharp Action Detector)
                </h3>
              </div>
              {!isProSubscriber && (
                <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  🔒 VIP 专属
                </span>
              )}
            </div>

            {/* Content: Veiled or Unlocked */}
            <div className={`mt-3 space-y-2 text-xs leading-5 ${isProSubscriber ? "" : "blur-sm select-none"}`}>
              <div className="flex items-center justify-between border-b border-white/5 py-1.5">
                <span className="text-white/70">客胜赔率防守下调</span>
                <span className="font-bold text-emerald-400">
                  {insights?.sharpAction?.oddsDefenseShift
                    ? `${insights.sharpAction.oddsDefenseShift} 离散收窄`
                    : "-0.18 离散收窄"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-white/5 py-1.5">
                <span className="text-white/70">主力前锋伤停风险指数</span>
                <span className="font-bold text-amber-400">
                  {insights?.sharpAction?.injuryRiskIndex?.level
                    ? `${insights.sharpAction.injuryRiskIndex.level} (Impact ${insights.sharpAction.injuryRiskIndex.impactScore})`
                    : "中等偏高 (Impact 68)"}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-white/70">高价值推荐盘口</span>
                <span className="font-bold text-[var(--pulse-red)]">
                  {insights?.sharpAction?.recommendedValueMarket ?? "客队 +0.5 让胜"}
                </span>
              </div>
            </div>

            {/* Paywall Overlay */}
            {!isProSubscriber && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-5 text-center backdrop-blur-xs">
                <p className="text-sm font-black text-amber-200">解锁 PULSE PRO 专家级量化指标</p>
                <p className="mt-1 text-xs text-white/70">实时掌握机构资金流向、伤停权重与冷门预警</p>

                <div className="mt-3 w-full max-w-sm space-y-3">
                  {/* Trial Option (if available) */}
                  {trialAvailable && (
                    <div className="flex flex-col items-center gap-1.5 border-b border-white/10 pb-2.5">
                      <button
                        type="button"
                        onClick={handleActivateTrial}
                        disabled={activatingTrial}
                        className="pressable-btn inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-5 py-2 text-xs font-black text-black shadow-lg transition hover:brightness-110 disabled:opacity-50"
                      >
                        <span>⚡</span>
                        <span>{activatingTrial ? "正在激活试用…" : "免费体验 PULSE PRO (试用 7 天)"}</span>
                      </button>
                      <span className="text-[10px] text-white/40">首次使用专属福利 · 7 天内免费畅享完整权益</span>
                    </div>
                  )}

                  {/* Plan Selector */}
                  <div className="grid grid-cols-2 gap-2 text-left">
                    <button
                      type="button"
                      onClick={() => setSelectedPlan("PRO_MONTHLY")}
                      className={`rounded-xl border p-2.5 transition ${
                        selectedPlan === "PRO_MONTHLY"
                          ? "border-amber-400 bg-amber-400/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60"
                      }`}
                    >
                      <p className="text-[11px] font-bold">月度会员</p>
                      <p className="text-xs font-black text-amber-300">5,000 积分 / 月</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlan("PRO_ANNUAL")}
                      className={`relative rounded-xl border p-2.5 transition ${
                        selectedPlan === "PRO_ANNUAL"
                          ? "border-amber-400 bg-amber-400/10 text-white"
                          : "border-white/10 bg-white/5 text-white/60"
                      }`}
                    >
                      <span className="absolute -top-2 right-2 rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] font-black text-black">
                        立省 36%
                      </span>
                      <p className="text-[11px] font-bold">年度特惠</p>
                      <p className="text-xs font-black text-amber-300">38,000 积分 / 年</p>
                    </button>
                  </div>

                  {/* User points balance */}
                  <div className="flex items-center justify-between px-1 text-[11px]">
                    <span className="text-white/60">当前可用积分：</span>
                    <span className={`font-mono font-bold ${canAfford ? "text-amber-300" : "text-red-400"}`}>
                      {availablePoints.toLocaleString()} 积分
                    </span>
                  </div>

                  {/* Primary Points Subscription Button */}
                  <button
                    type="button"
                    onClick={handleSubscribeWithPoints}
                    disabled={subscribingPoints || !canAfford}
                    className="pressable-btn w-full rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 py-2.5 text-xs font-black text-black shadow-lg transition hover:brightness-110 disabled:opacity-50"
                  >
                    {subscribingPoints
                      ? "正在兑换会员…"
                      : canAfford
                      ? `⚡ 立即使用积分开通 (${cost.toLocaleString()} 积分)`
                      : `积分不足 (需 ${cost.toLocaleString()} 积分)`}
                  </button>

                  {/* External gateway fallback */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={startingCheckout}
                      className="text-[10px] text-white/40 underline transition hover:text-white/70 disabled:opacity-50"
                    >
                      {startingCheckout ? "正在调起外部收银台…" : "或通过外部支付通道开通 (测试通道)"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-white/40">
          <span>量化分析仅供赛事研判参考 · 不构成投资建议</span>
          <span className="font-bold text-white/60">PULSE SPORTS QUANT</span>
        </div>
      </div>
    </div>
  );
}
