import type { Metadata } from "next";
import { FootballMatchMap } from "./football-match-map";
import "../pulse.css";

export const metadata: Metadata = { title: "PULSE · 足球比赛地图", robots: { index: false, follow: false } };

export default function FootballMatchPage() {
  return <FootballMatchMap />;
}
