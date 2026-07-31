import type { Metadata } from "next";
import { ClubEntryCard } from "@/features/club/club-entry-card";
import { SportTabs } from "@/features/f1/sport-tabs";
import { MatchList } from "@/features/matchday/match-list";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "比赛" };
export default function MatchesPage() { return <PrivateShell title="比赛中心" description="这里仅展示产品缓存中的赛事数据；数据过期或不可用时会明确标注。"><div className="grid gap-6"><SportTabs active="FOOTBALL"/><ClubEntryCard/><MatchList/></div></PrivateShell>; }
