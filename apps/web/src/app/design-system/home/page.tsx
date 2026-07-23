import type { Metadata } from "next";
import { CircuitMap, LogoA1, MobileBottomNav, PulseHeader, PulseLine } from "../components";
import { CIRCUITS } from "../circuits";
import { PulseMotion } from "../prototype-motion";
import "../pulse.css";

export const metadata: Metadata = {
  title: "PULSE 首页原型",
  robots: { index: false, follow: false },
};

/* 当日主赛事媒体面板：真实 Silverstone 赛道轮廓（§11.1 每天随重点赛事切换主视觉） */
function HeroMedia({ className = "" }: { className?: string }) {
  return (
    <span className={`pd-media-panel ${className}`} aria-hidden="true">
      <CircuitMap circuit="silverstone" stroke="var(--pulse-red)" strokeWidth={2.5} />
      <span className="pd-media-caption">TODAY · F1 · British Grand Prix · Silverstone</span>
    </span>
  );
}

/* 三项运动章节的线条语法（§8.3）：足球中圈弧 / 篮球三分弧 / F1 赛道 */
function SportArt({ kind }: { kind: "football" | "basketball" | "f1" }) {
  return (
    <svg className="pd-sport-art" viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {kind === "football" && (
        <>
          <circle cx="200" cy="60" r="70" fill="none" stroke="var(--pulse-red-deep)" strokeWidth="1.5" />
          <line x1="0" y1="60" x2="400" y2="60" stroke="var(--pulse-red-deep)" strokeWidth="1" opacity="0.6" />
          <path d="M40 320 A 90 90 0 0 1 220 320" fill="none" stroke="var(--pulse-red-deep)" strokeWidth="1.5" />
        </>
      )}
      {kind === "basketball" && (
        <>
          <path d="M-40 40 A 180 180 0 0 0 320 40" fill="none" stroke="var(--pulse-red-deep)" strokeWidth="1.5" />
          <circle cx="140" cy="230" r="46" fill="none" stroke="var(--pulse-red-deep)" strokeWidth="1.5" />
        </>
      )}
      {kind === "f1" && (
        <path d={CIRCUITS.spa.path} fill="none" stroke="var(--pulse-red-deep)" strokeWidth="2" strokeLinejoin="round" />
      )}
    </svg>
  );
}

const MECHANISM = [
  { n: "01", t: "选择赛事", d: "足球、篮球、F1，真实赛程自动同步或由管理员发布。" },
  { n: "02", t: "提交判断", d: "确认最新倍率后投入虚拟积分，封盘前可随时改主意。" },
  { n: "03", t: "自动封盘与结算", d: "开赛即封盘，官方结果出来后系统自动结算到账本。" },
  { n: "04", t: "和朋友长期排名", d: "命中率、积分与连胜都留在房间里，赛季结束见真章。" },
];

export default function PulseHomePrototype() {
  return (
    <div className="pulse-scope pd-band-dark pd-has-bottom-nav" style={{ minHeight: "100vh" }}>
      <PulseMotion />
      <PulseHeader active="赛事" />
      <main id="main-content">

      {/* Hero：数字封面（§11.1） */}
      <section className="pd-hero">
        <div className="pd-hero-grid">
          <div className="pd-hero-copy">
            <div className="pd-eyebrow pd-enter pd-enter--1"><span>01 / TODAY</span></div>
            <h1 className="pd-hero-title">
              <span className="pd-hero-call pd-enter pd-enter--2">Call</span>
              <span className="pd-hero-the">The</span>
              <HeroMedia className="pd-hero-mobile-media" />
              <span className="pd-hero-moment pd-enter pd-enter--3">Moment.</span>
            </h1>
            <p className="pd-hero-sub pd-enter pd-enter--4">每一刻，都有判断。足球、篮球、F1，与朋友记录每一次判断。</p>
            <div className="pd-hero-cta pd-enter pd-enter--5">
              <a href="#events" className="pd-btn pd-btn--primary">浏览今日赛事 →</a>
              <a href="/design-system/room" className="pd-btn pd-btn--ghost" style={{ color: "var(--pulse-muted)" }}>进入房间</a>
            </div>
          </div>
          <div className="pd-hero-side pd-enter pd-enter--4">
            <div className="pd-hero-telemetry">
              <span><b>03</b> SPORTS</span>
              <span><b>12</b> EVENTS TODAY</span>
              <span className="pd-num">NEXT · 排位赛 · <b>03:42:18</b></span>
            </div>
            <HeroMedia className="pd-hero-desktop-media" />
          </div>
        </div>
        {/* PULSE LINE 落入 Live Rail（§11.1） */}
        <div style={{ height: 22, maxWidth: 1440, margin: "0 auto", padding: "0 clamp(1.25rem,4vw,3.5rem)" }}>
          <PulseLine state="upcoming" />
        </div>
      </section>

      {/* Live Rail（§11.2） */}
      <section className="pd-rail" id="events" aria-label="今日赛事条">
        <a className="pd-rail-row" href="/design-system/football-match">
          <span className="pd-rail-kind pd-rail-kind--live"><i className="pd-blink" />LIVE</span>
          <span>世界杯 · 法国 <b className="pd-num">2–1</b> 西班牙</span>
          <time>78&#39;</time>
        </a>
        <a className="pd-rail-row" href="/design-system/f1-assets">
          <span className="pd-rail-kind pd-rail-kind--next">NEXT</span>
          <span>F1 · 英国大奖赛 排位赛</span>
          <time>周六 22:00</time>
        </a>
        <a className="pd-rail-row" href="/design-system/football-match">
          <span className="pd-rail-kind pd-rail-kind--next">NEXT</span>
          <span>英超 · 阿森纳 vs 曼城</span>
          <time>周日 23:30</time>
        </a>
      </section>

      {/* 三项运动章节（§11.3：赛道式目录 6/3/3） */}
      <section data-pd-reveal>
        <div className="pd-wrap" style={{ paddingBottom: "1.5rem" }}>
          <div className="pd-eyebrow"><span>02 / 三项运动</span></div>
          <h2 className="pd-h2">One Club, Three Arenas</h2>
        </div>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 clamp(1.25rem,4vw,3.5rem) 4rem" }}>
          <div className="pd-sports-grid">
            <a className="pd-sport-panel" href="/design-system/football-match">
              <SportArt kind="football" />
              <span className="pd-sport-name">Football</span>
              <span className="pd-sport-meta">
                <span className="pd-sport-count">今日 8 场</span>
                <span>下一场 21:00</span>
                <span>热门 · 阿森纳主胜</span>
              </span>
            </a>
            <a className="pd-sport-panel" href="/design-system/basketball">
              <SportArt kind="basketball" />
              <span className="pd-sport-name">Basketball</span>
              <span className="pd-sport-meta">
                <span className="pd-sport-count">休赛期</span>
                <span>10 月回归</span>
              </span>
            </a>
            <a className="pd-sport-panel" href="/design-system/f1-assets">
              <SportArt kind="f1" />
              <span className="pd-sport-name">Formula 1</span>
              <span className="pd-sport-meta">
                <span className="pd-sport-count">周末 4 场</span>
                <span>排位 SAT 22:00</span>
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* 产品机制（§11.4） */}
      <section id="how-it-works" data-pd-reveal style={{ borderTop: "1px solid var(--pulse-line-dark)" }}>
        <div className="pd-wrap pd-cols pd-cols-57">
          <div>
            <div className="pd-eyebrow"><span>03 / 怎么玩</span></div>
            <h2 className="pd-h2">Four Steps</h2>
            <p className="pd-note">虚拟积分不可充值、提现或兑换，输赢只关乎面子。</p>
          </div>
          <div className="pd-mech">
            {MECHANISM.map((m) => (
              <div className="pd-mech-row" key={m.n}>
                <code>{m.n}</code>
                <div><b>{m.t}</b><p>{m.d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>
      </main>

      {/* 页脚合规（§11.5） */}
      <footer className="pd-footer">
        <div className="pd-wrap">
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <LogoA1 size={26} />
            <span className="pd-display-type" style={{ fontSize: "1.1rem" }}>PULSE <small style={{ fontSize: "0.6rem", letterSpacing: "0.3em", color: "var(--pulse-muted)" }}>SPORTS CLUB</small></span>
          </div>
          <p>仅使用虚拟积分，不支持充值、提现或兑换。18 岁以上用户可使用。</p>
        </div>
      </footer>

      <MobileBottomNav active="赛事" />
    </div>
  );
}
