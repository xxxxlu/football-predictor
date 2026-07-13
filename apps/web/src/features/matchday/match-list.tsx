"use client";
import { useEffect, useState } from "react";
import { MatchCard } from "@/components/match-card";
import { PredictionSlip } from "./prediction-slip";
import { normalizeMatch, type ApiEnvelope, type ApiFailure, type MatchView } from "./types";

export function MatchList({ roomId, interactive = false }: { roomId?: string; interactive?: boolean }) {
  const [matches, setMatches] = useState<MatchView[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : ""; const response = await fetch(`/api/v1/matches${query}`, { credentials: "same-origin", signal: controller.signal }); const result = await response.json().catch(() => ({})) as ApiEnvelope<unknown[]> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "比赛数据暂不可用"); const normalized = Array.isArray(result.data) ? result.data.map(item => normalizeMatch(item as Parameters<typeof normalizeMatch>[0])).filter((item): item is MatchView => item !== null) : []; setMatches(normalized); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "比赛数据暂不可用"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [roomId, retry]);
  if (loading) return <div aria-live="polite" aria-busy="true" className="space-y-3">{[1,2,3].map(n => <div key={n} className="surface h-36 animate-pulse bg-white/45"/>)}<span className="sr-only">正在加载比赛</span></div>;
  if (error) return <Empty title="暂时无法取得比赛" text={error} action={<button onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }} className="border border-[var(--ink)] px-4 py-2 font-bold">重试</button>}/>;
  if (!matches.length) return <Empty title="目前没有可显示的比赛" text="同步完成后，目标赛事会出现在这里。"/>;
  return <div className="space-y-4">{matches.map(match => <MatchCard key={match.id} match={match} action={interactive && roomId ? <PredictionSlip roomId={roomId} match={match}/> : undefined}/>)}</div>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <section className="surface p-8 text-center"><p className="display text-xl font-bold">{title}</p><p className="mt-2 text-sm text-[var(--muted)]">{text}</p>{action && <div className="mt-5">{action}</div>}</section>; }
