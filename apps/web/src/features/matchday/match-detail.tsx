"use client";

import { useEffect, useState } from "react";
import { MatchCard } from "@/components/match-card";
import { StatusMessage } from "@/components/status-message";
import { LineupMap } from "./lineup-map";
import { matchViewFromDetailPayload, type MatchView } from "./types";

export function MatchDetail({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<MatchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/matches/${encodeURIComponent(matchId)}`, {
          credentials: "same-origin",
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload as { error?: { message?: string } } | null)?.error?.message || "比赛数据暂不可用");
        setMatch(matchViewFromDetailPayload(payload));
        setError("");
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "比赛数据暂不可用");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [matchId]);

  return (
    <div className="grid gap-8">
      <section aria-label="比赛信息">
        {loading ? (
          <div className="pitch-skeleton h-40 rounded-xl" aria-busy="true"><span className="sr-only">正在加载比赛信息</span></div>
        ) : error ? (
          <StatusMessage tone="error" title="暂时无法取得比赛信息">{error}</StatusMessage>
        ) : match ? (
          <MatchCard match={match} />
        ) : (
          <StatusMessage tone="info" title="未找到该比赛">该比赛不在当前产品缓存中，可能已结束轮换或尚未同步。</StatusMessage>
        )}
      </section>

      <section aria-label="阵容">
        <h2 className="kinetic mb-4 text-[clamp(1.5rem,4vw,2.25rem)]">首发阵容</h2>
        <LineupMap matchId={matchId} />
      </section>
    </div>
  );
}
