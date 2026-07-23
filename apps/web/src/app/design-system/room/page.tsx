import type { Metadata } from "next";
import { MobileBottomNav, PulseHeader, PulseLine } from "../components";
import { InteractiveSportSwitcher, PulseMotion } from "../prototype-motion";
import "../pulse.css";

export const metadata: Metadata = {
  title: "PULSE 房间原型",
  robots: { index: false, follow: false },
};

const SPORT_STATS = [
  { sport: "足球", pct: 61, sample: "23 场" },
  { sport: "篮球", pct: 54, sample: "11 场" },
  { sport: "F1", pct: 38, sample: "8 场" },
];

/* 演示数据：全部为虚构人物，不使用真实姓名 */
const FEED = [
  { who: "飞", name: "阿飞", pick: "F1 · 英国站排位 · 杆位 NOR @3.20", stake: "2,000", state: "待封盘", cls: "" },
  { who: "K", name: "老K", pick: "英超 · 阿森纳 vs 曼城 · 主胜 @2.10", stake: "1,500", state: "已封盘", cls: "pd-status--locked" },
  { who: "M", name: "Momo", pick: "世界杯 · 法国 vs 西班牙 · 比分 2–1 @8.50", stake: "500", state: "已命中 +4,250", cls: "pd-status--success" },
];

export default function PulseRoomPrototype() {
  return (
    <div className="pulse-scope pd-band-light pd-has-bottom-nav" style={{ minHeight: "100vh" }}>
      <PulseMotion />
      <PulseHeader active="房间" />
      <main id="main-content">

      {/* 房间头部：品牌红信息条（§14.1） */}
      <section className="pd-room-hero">
        <div className="pd-wrap">
          <div className="pd-room-title-row">
            <h1 className="pd-room-name">Redline Friends</h1>
            <span className="pd-tag pd-room-vis"><span>Public</span></span>
          </div>
          <p className="pd-room-sub">综合运动房间 · 12 位成员 · 2026 赛季</p>
        </div>
      </section>

      {/* 积分条：暖白底 */}
      <div id="balance" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 clamp(1.25rem,4vw,3.5rem)" }}>
        <div className="pd-balance-strip">
          <div className="pd-balance-cell"><small>可用积分</small><b>8,230</b></div>
          <div className="pd-balance-cell"><small>冻结</small><b>2,000</b></div>
          <div className="pd-balance-cell"><small>房间排名</small><b>#3</b></div>
          <div className="pd-balance-cell"><small>命中率</small><b>58%<small style={{ fontFamily: "var(--pd-font-body)" }}> · 42 场</small></b></div>
        </div>
      </div>

      {/* 标签（§14.2：成员投入固定在标签区） */}
      <div style={{ maxWidth: 1280, margin: "1.75rem auto 0", padding: "0 clamp(1.25rem,4vw,3.5rem)" }}>
        <nav className="pd-tabs" aria-label="房间栏目">
          <a href="#overview" aria-current="page">概览</a>
          <a href="/design-system/home#events">赛事</a>
          <a href="#members">成员投入</a>
          <a href="#performance">排行榜</a>
          <a href="#balance">账本</a>
          <a href="#room-settings">设置</a>
        </nav>
      </div>

      <div id="overview" className="pd-wrap" style={{ paddingTop: "2rem" }}>
        {/* 运动筛选 */}
        <div style={{ marginBottom: "2rem" }}>
          <InteractiveSportSwitcher initial="全部" />
        </div>

        <div className="pd-cols pd-cols-57">
          {/* 左：多运动统计（§14.3 带样本量） */}
          <div id="performance" data-pd-reveal>
            <div className="pd-eyebrow"><span>战绩 · 2026 赛季</span></div>
            <div style={{ display: "flex", gap: "2.5rem", alignItems: "baseline", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              <span className="pd-num" style={{ fontSize: "2.4rem", fontWeight: 600 }}>+12,480</span>
              <span style={{ color: "var(--pulse-muted)" }}>总战绩 12 胜 / 8 负</span>
            </div>
            <div className="pd-sport-stats">
              {SPORT_STATS.map((s) => (
                <div className="pd-sport-stat-row" key={s.sport}>
                  <span>{s.sport}命中率</span>
                  <span className="pd-bar"><i style={{ width: `${s.pct}%` }} /></span>
                  <span><b className="pd-num">{s.pct}%</b><small>样本 {s.sample}</small></span>
                </div>
              ))}
            </div>
            <div style={{ height: 22, marginTop: "1.5rem" }}><PulseLine state="ambient" /></div>
          </div>

          {/* 右：成员投入记录 */}
          <div id="members" data-pd-reveal>
            <div className="pd-eyebrow"><span>成员投入 · 最近 3 条</span></div>
            <div className="pd-feed">
              {FEED.map((f) => (
                <div className="pd-feed-row" key={f.name}>
                  <span className="pd-feed-avatar">{f.who}</span>
                  <span>
                    {f.name}
                    <small>{f.pick}</small>
                  </span>
                  <span className="pd-num">{f.stake}</span>
                  <span className={`pd-status ${f.cls}`} style={f.cls ? undefined : { background: "oklch(94% 0.02 91)", color: "var(--pulse-muted)" }}>{f.state}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: "1rem" }}>
              <a className="pd-btn pd-btn--ghost" href="#members">查看全部投入记录 →</a>
            </p>
          </div>
        </div>
      </div>
      </main>

      <footer id="room-settings" style={{ borderTop: "1px solid var(--pulse-line-light)" }}>
        <div className="pd-wrap" style={{ paddingTop: "1.5rem", paddingBottom: "2rem" }}>
          <p className="pd-slip-meta">仅使用虚拟积分，不支持充值、提现或兑换。 · PULSE 房间原型 · 数据为演示样本</p>
        </div>
      </footer>

      <MobileBottomNav active="房间" />
    </div>
  );
}
