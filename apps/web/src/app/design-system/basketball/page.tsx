import type { Metadata } from "next";
import { MobileBottomNav, PulseHeader } from "../components";
import "../pulse.css";

export const metadata: Metadata = { title: "PULSE · 篮球赛事", robots: { index: false, follow: false } };

export default function BasketballPage() {
  return <div className="pulse-scope pd-band-dark pd-has-bottom-nav" style={{ minHeight: "100vh" }}>
    <PulseHeader active="赛事" />
    <main id="main-content" className="pd-wrap pd-event-landing">
      <div className="pd-eyebrow"><span>BASKETBALL / COURT</span><span className="pd-tag pd-tag--lime"><span>COMING SOON</span></span></div>
      <h1 className="pd-h2">篮球赛事中心</h1>
      <p className="pd-note">独立的篮球赛程、比分、球员轮换与投篮热区页面。先通过右上角切换赛事，不和足球、F1 混在一起。</p>
      <div className="pd-event-placeholder"><span className="pd-display-type">COURT</span><small>赛程数据接入后，这里会展示实时比赛和球员五人组。</small></div>
      <a className="pd-btn pd-btn--outline" href="/design-system/home#events">返回赛事首页 →</a>
    </main>
    <MobileBottomNav active="赛事" />
  </div>;
}
