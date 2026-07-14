"use client";
import { useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";

type MemberState = { userId: string; displayName: string; submitted: boolean };
type FixtureState = { matchId: string; homeTeam: string; awayTeam: string; kickoffAt: string; status: "OPEN" | "CLOSED" | "FINISHED"; members: MemberState[] };
type SubmissionStatus = { roomId: string; roomName: string; viewerRole: "room_owner" | "member"; fixtures: FixtureState[] };

export function SubmissionStatusView({ roomId }: { roomId: string }) {
  const [data, setData] = useState<SubmissionStatus>(); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [forbidden, setForbidden] = useState(false);
  useEffect(() => { const controller = new AbortController(); void (async () => { try { const response = await fetch(`/api/v1/rooms/${encodeURIComponent(roomId)}/submission-status`, { credentials: "same-origin", signal: controller.signal }); if (response.status === 401 || response.status === 403) { setForbidden(true); return; } const result = await response.json().catch(() => ({})) as ApiEnvelope<SubmissionStatus> & ApiFailure; if (!response.ok) throw new Error(result.error?.message || "无法加载提交状态"); if (result.data.viewerRole !== "room_owner") { setForbidden(true); return; } setData(result.data); } catch (reason) { if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "无法加载提交状态"); } finally { setLoading(false); } })(); return () => controller.abort(); }, [roomId]);
  if (loading) return <DataStatePanel state="loading" title="正在加载成员状态" description=""/>;
  if (forbidden) return <DataStatePanel state="forbidden" title="只有房主可以查看" description="成员提交状态仅用于房主确认参与情况；封盘前任何人的选择和投入都不会显示。"/>;
  if (error || !data) return <DataStatePanel state="error" title="提交状态暂不可用" description={error || "服务未返回有效状态。"}/>;
  if (!data.fixtures.length) return <DataStatePanel state="empty" title="暂无目标比赛" description="有可参与的比赛后，这里会显示成员是否已经提交。"/>;
  return <div><div className="mb-5 rounded-xl border-l-4 border-[var(--field)] bg-[#edf7f1] p-4 text-sm leading-6"><strong>隐私保护已开启</strong><p className="text-[var(--muted)]">这里始终只消费成员名称和是否提交字段，不读取选择、投入或赔率。</p></div><div className="space-y-5">{data.fixtures.map(fixture => <article key={fixture.matchId} className="surface overflow-hidden"><header className="border-b rule p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="display text-xl font-bold">{fixture.homeTeam} <span className="text-sm font-normal text-[var(--muted)]">对</span> {fixture.awayTeam}</h2><time className="tabular text-xs text-[var(--muted)]" dateTime={fixture.kickoffAt}>{new Date(fixture.kickoffAt).toLocaleString("zh-CN")}</time></div><p className="mt-2 text-xs font-bold text-[var(--field)]">已提交 {fixture.members.filter(member => member.submitted).length} / {fixture.members.length}</p></header><ul className="divide-y divide-[var(--line)]">{fixture.members.map(member => <li key={member.userId} className="flex items-center justify-between gap-4 p-4"><span className="truncate font-bold">{member.displayName}</span><span className={`shrink-0 text-sm font-bold ${member.submitted ? "text-[var(--field)]" : "text-[var(--muted)]"}`}>{member.submitted ? "✓ 已提交" : "○ 未提交"}</span></li>)}</ul></article>)}</div></div>;
}
