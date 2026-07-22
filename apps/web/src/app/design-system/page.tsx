import type { Metadata } from "next";
import { CircuitMap, LogoA1, LogoA2, LogoA3, PulseLine } from "./components";
import { PulseMotion } from "./prototype-motion";
import "./pulse.css";

export const metadata: Metadata = {
  title: "PULSE Design System",
  robots: { index: false, follow: false },
};

/* ---------- 页面 ---------- */

const SWATCHES = [
  { name: "--pulse-carbon", value: "oklch(13% .008 155)", bg: "var(--pulse-carbon)", fg: "var(--pulse-ivory)" },
  { name: "--pulse-carbon-2", value: "oklch(18% .01 155)", bg: "var(--pulse-carbon-2)", fg: "var(--pulse-ivory)" },
  { name: "--pulse-red", value: "oklch(65% .235 32)", bg: "var(--pulse-red)", fg: "var(--pulse-carbon)" },
  { name: "--pulse-red-deep", value: "oklch(43% .175 30)", bg: "var(--pulse-red-deep)", fg: "var(--pulse-ivory)" },
  { name: "--pulse-ivory", value: "oklch(95.5% .018 91)", bg: "var(--pulse-ivory)", fg: "var(--pulse-carbon)" },
  { name: "--pulse-paper", value: "oklch(98% .01 91)", bg: "var(--pulse-paper)", fg: "var(--pulse-carbon)" },
  { name: "--pulse-lime", value: "oklch(92% .235 119)", bg: "var(--pulse-lime)", fg: "var(--pulse-carbon)" },
  { name: "--pulse-muted", value: "oklch(64% .012 155)", bg: "var(--pulse-muted)", fg: "var(--pulse-carbon)" },
];

const LINE_STATES = [
  { key: "ambient", label: "Ambient", desc: "1px 暗红连续线 · 分区与方向感" },
  { key: "upcoming", label: "Upcoming", desc: "短实线 + 时间刻度 · 距封盘的时间关系" },
  { key: "live", label: "Live", desc: "荧光点沿红线推进 · 真实进行中" },
  { key: "locked", label: "Locked", desc: "线条在切口处收束 · 封盘反馈" },
  { key: "settled", label: "Settled", desc: "闭合为结果印章 · 结算完成" },
] as const;

export default function DesignSystemPage() {
  return (
    <main id="main-content" className="pulse-scope">
      <PulseMotion />
      {/* 00 · 品牌区（碳黑，品牌模式） */}
      <header className="pd-band-dark">
        <div className="pd-wrap" style={{ paddingBottom: "2.5rem" }}>
          <div className="pd-eyebrow"><span>PULSE DESIGN SYSTEM · v0.1 · 内部样板页</span></div>
          <h1 className="pd-display-type" style={{ fontSize: "var(--type-display)", margin: 0 }}>
            CALL THE <span style={{ color: "var(--pulse-red)" }}>MOMENT.</span>
          </h1>
          <p style={{ maxWidth: "38ch", color: "var(--pulse-muted)", marginTop: "1rem" }}>
            每一刻，都有判断。红色竞技编辑部：封面大胆、正文克制、数字准确、状态清楚。
          </p>
          <p style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
            <a className="pd-btn pd-btn--primary" href="/design-system/home">首页原型 →</a>
            <a className="pd-btn pd-btn--outline" href="/design-system/room" style={{ color: "var(--pulse-ivory)" }}>房间原型 →</a>
            <a className="pd-btn pd-btn--outline" href="/design-system/f1-assets" style={{ color: "var(--pulse-ivory)" }}>2026 F1 素材库 →</a>
            <a className="pd-btn pd-btn--outline" href="/design-system/football-match" style={{ color: "var(--pulse-ivory)" }}>足球比赛地图 →</a>
          </p>
        </div>
      </header>

      {/* 01 · Logo 草案 */}
      <section className="pd-band-dark" style={{ borderTop: "1px solid var(--pulse-line-dark)" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>01 / Logo 草案 · 方案 A「PULSE SLASH」</span></div>
          <h2 className="pd-h2">P + 赛道弯道 + 11° 速度切口</h2>
          <p className="pd-note">2026-07-17 拍板：<b style={{ color: "var(--pulse-ivory)" }}>A1 基准型已选定为主 Logo 方向</b>（A3 为其 PWA 图标变体）；A2 鬃毛切线留档不用。当前仍为结构草案，待精修图稿。</p>
          <div className="pd-cols pd-cols-75">
            <div style={{ display: "flex", gap: "3rem", alignItems: "center", flexWrap: "wrap" }}>
              <figure style={{ margin: 0, textAlign: "center" }}>
                <LogoA1 size={140} />
                <figcaption className="pd-slip-meta">A1 · 基准 <span className="pd-tag pd-tag--lime" style={{ marginLeft: "0.4rem" }}><span>已选定</span></span></figcaption>
              </figure>
              <figure style={{ margin: 0, textAlign: "center" }}>
                <LogoA2 size={140} />
                <figcaption className="pd-slip-meta">A2 · 鬃毛切线</figcaption>
              </figure>
              <figure style={{ margin: 0, textAlign: "center" }}>
                <LogoA3 size={140} />
                <figcaption className="pd-slip-meta">A3 · PWA 图标</figcaption>
              </figure>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
                <LogoA1 size={40} />
                <span className="pd-display-type" style={{ fontSize: "2rem" }}>
                  PULSE <small style={{ fontSize: "0.75rem", letterSpacing: "0.35em", color: "var(--pulse-muted)" }}>SPORTS CLUB</small>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
                <LogoA1 size={24} />
                <span className="pd-slip-meta">24px 最小可用尺寸（§22 验收）</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 02 · 色彩 */}
      <section className="pd-band-dark" style={{ borderTop: "1px solid var(--pulse-line-dark)" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>02 / 色彩 Token · OKLCH 主源</span></div>
          <h2 className="pd-h2">碳黑承载 · 赛车红动作 · 暖白阅读</h2>
          <div className="pd-swatches">
            {SWATCHES.map((s) => (
              <div key={s.name} className="pd-swatch" style={{ background: s.bg, color: s.fg }}>
                <b>{s.name.replace("--pulse-", "")}</b>
                <span>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="pd-ratio">
            <div style={{ width: "45%", background: "var(--pulse-carbon-2)", color: "var(--pulse-ivory)" }}>碳黑 45</div>
            <div style={{ width: "30%", background: "var(--pulse-ivory)", color: "var(--pulse-carbon)" }}>暖白 30</div>
            <div style={{ width: "20%", background: "var(--pulse-red)", color: "var(--pulse-carbon)" }}>红 20</div>
            <div style={{ width: "3%", background: "var(--pulse-lime)" }} title="荧光 3%" />
            <div style={{ width: "2%", background: "var(--pulse-teal)" }} title="辅助 2%" />
          </div>
        </div>
      </section>

      {/* 03 · 字体阶梯 */}
      <section className="pd-band-dark" style={{ borderTop: "1px solid var(--pulse-line-dark)" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>03 / 字体阶梯 · 等宽数字</span></div>
          <h2 className="pd-h2">大标题压缩 · 数字遥测</h2>
          <p className="pd-note">样板页用系统近似栈；Phase 2 以本地 WOFF2 落地 Barlow Condensed / Noto Sans SC / IBM Plex Mono。</p>
          <div>
            <div className="pd-type-row"><code>--type-section</code><span className="pd-display-type" style={{ fontSize: "var(--type-section)" }}>MATCHDAY</span></div>
            <div className="pd-type-row"><code>--type-card-title</code><span className="pd-display-type" style={{ fontSize: "var(--type-card-title)" }}>British Grand Prix</span></div>
            <div className="pd-type-row"><code>--type-body</code><span style={{ fontSize: "var(--type-body)" }}>和朋友一起预测，用虚拟积分留下每一次判断。</span></div>
            <div className="pd-type-row">
              <code>tabular-nums</code>
              <span className="pd-num" style={{ fontSize: "1.6rem" }}>
                +12,480 <span style={{ color: "var(--pulse-lime)" }}>▲2</span> · 3.20× · 01:18:32
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 04 · PULSE LINE */}
      <section className="pd-band-dark" style={{ borderTop: "1px solid var(--pulse-line-dark)", paddingBottom: "1rem" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>04 / 品牌母题 · PULSE LINE 五状态</span></div>
          <h2 className="pd-h2">一条有信息职责的线</h2>
          <div className="pd-line-demo">
            {LINE_STATES.map((s) => (
              <div className="pd-line-row" key={s.key}>
                <b>{s.label}</b>
                <div>
                  <PulseLine state={s.key} />
                  <span className="pd-slip-meta">{s.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 05 · 三类赛事卡（暖白，工具模式） */}
      <section id="event-cards" className="pd-band-light" data-pd-reveal style={{ borderTop: "3px solid var(--pulse-red)" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>05 / 赛事卡 · 同一品牌，三种结构</span></div>
          <h2 className="pd-h2">Football / Basketball / Formula 1</h2>
          <p className="pd-note">工具模式：暖白底、高信息密度、一个红色焦点。三卡结构必须明显不同（§22 验收）。</p>

          <div className="pd-cols" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {/* 足球卡 */}
            <article className="pd-card">
              <div className="pd-card-head"><span>英超 · Matchweek 2</span><time>周日 23:30</time></div>
              <div className="pd-foot-teams">
                <div className="pd-foot-team">Arsenal<small>阿森纳</small></div>
                <span className="pd-foot-vs">VS</span>
                <div className="pd-foot-team" style={{ textAlign: "right" }}>Man City<small>曼城</small></div>
              </div>
              <div className="pd-outcomes">
                <button className="pd-outcome" type="button"><span>主胜</span><b>2.10</b></button>
                <button className="pd-outcome" type="button" aria-pressed="true"><span>平局</span><b>3.40</b></button>
                <button className="pd-outcome" type="button"><span>客胜</span><b>3.00</b></button>
              </div>
            </article>

            {/* 篮球卡 */}
            <article className="pd-card">
              <div className="pd-card-head"><span>NBA · Q4 05:32</span><span className="pd-live-badge"><i className="pd-blink" />LIVE</span></div>
              <div>
                <div className="pd-bball-row"><b>Lakers 湖人</b><span className="pd-score">101</span></div>
                <div className="pd-bball-row"><b>Warriors 勇士</b><span className="pd-score" style={{ color: "var(--pulse-muted)" }}>98</span></div>
              </div>
              <div className="pd-outcomes">
                <button className="pd-outcome" type="button"><span>胜负</span><b>1.85</b></button>
                <button className="pd-outcome" type="button"><span>让分 −3.5</span><b>1.92</b></button>
                <button className="pd-outcome" type="button"><span>总分 221.5</span><b>1.90</b></button>
              </div>
            </article>

            {/* F1 计时塔卡（背景：真实 Silverstone 轮廓） */}
            <article id="f1-card" className="pd-card" style={{ position: "relative", overflow: "hidden" }}>
              <div aria-hidden="true" style={{ position: "absolute", inset: "0 -18% 0 auto", width: "70%", opacity: 0.13, pointerEvents: "none" }}>
                <CircuitMap circuit="silverstone" stroke="currentColor" strokeWidth={2} showStart={false} />
              </div>
              <div className="pd-card-head"><span>Formula 1 · British GP</span><time>排位赛 · 周六 22:00</time></div>
              <div style={{ position: "relative" }}>
                <div className="pd-f1-row"><span className="pd-f1-pos">01</span><i className="pd-f1-teamline" style={{ background: "oklch(70% .17 60)" }} /><span className="pd-f1-driver">NOR<small>诺里斯</small></span><b className="pd-num">3.20</b></div>
                <div className="pd-f1-row"><span className="pd-f1-pos">02</span><i className="pd-f1-teamline" style={{ background: "oklch(55% .15 260)" }} /><span className="pd-f1-driver">VER<small>维斯塔潘</small></span><b className="pd-num">3.50</b></div>
                <div className="pd-f1-row"><span className="pd-f1-pos">03</span><i className="pd-f1-teamline" style={{ background: "oklch(70% .17 60)" }} /><span className="pd-f1-driver">PIA<small>皮亚斯特里</small></span><b className="pd-num">4.10</b></div>
              </div>
              <button className="pd-btn pd-btn--ghost" type="button">查看全部 22 位车手 →</button>
            </article>
          </div>

          {/* Race Weekend 主卡 */}
          <div className="pd-cols pd-cols-57" style={{ marginTop: "2.5rem" }}>
            <article className="pd-card" style={{ background: "var(--pulse-carbon)", color: "var(--pulse-ivory)", borderColor: "var(--pulse-carbon)", position: "relative", overflow: "hidden" }}>
              <div aria-hidden="true" style={{ position: "absolute", inset: "-8% -12% -8% auto", width: "56%", opacity: 0.22, pointerEvents: "none" }}>
                <CircuitMap circuit="spa" stroke="var(--pulse-red)" strokeWidth={2} showStart={false} />
              </div>
              <div className="pd-card-head" style={{ color: "var(--pulse-muted)", position: "relative" }}>
                <span className="pd-display-type" style={{ fontSize: "1.3rem", color: "var(--pulse-ivory)" }}>Belgian Grand Prix</span>
                <time>19–21 JUL</time>
              </div>
              <div style={{ position: "relative" }}>
                <div className="pd-weekend-row"><code>SQ</code><span>冲刺排位</span><time>FRI 22:30</time><span className="pd-weekend-state pd-weekend-state--done">已结算</span></div>
                <div className="pd-weekend-row"><code>S</code><span>冲刺赛</span><time>SAT 18:00</time><span className="pd-weekend-state pd-weekend-state--live"><i className="pd-blink" />LIVE</span></div>
                <div className="pd-weekend-row"><code>Q</code><span>排位赛</span><time>SAT 22:00</time><span className="pd-weekend-state"><span className="pd-tag"><span>即将开放</span></span></span></div>
                <div className="pd-weekend-row"><code>R</code><span>正赛</span><time>SUN 21:00</time><span className="pd-weekend-state pd-weekend-state--done">12 个市场</span></div>
              </div>
              <div style={{ height: 20 }}><PulseLine state="live" /></div>
            </article>

            {/* Prediction Slip */}
            <aside className="pd-slip">
              <div className="pd-slip-head">
                <b>Your Call / 本次判断</b>
                <span className="pd-tag"><span>01</span></span>
              </div>
              <div className="pd-slip-body">
                <span className="pd-slip-meta">比利时大奖赛 · 排位赛 · 杆位获得者</span>
                <div className="pd-slip-line"><span className="pd-f1-driver">04 · Lando Norris</span><b className="pd-num">3.20×</b></div>
                <hr />
                <div className="pd-slip-line"><span>投入积分</span><span className="pd-num">2,000</span></div>
                <div className="pd-slip-line"><span>预计返还</span><b className="pd-num" style={{ color: "var(--pulse-red-deep)" }}>6,400</b></div>
              </div>
              <div className="pd-slip-foot">
                <button className="pd-btn pd-btn--primary" type="button">确认最新倍率并提交 →</button>
                <span className="pd-slip-meta pd-num">数据更新于 18:42 · 封盘倒计时 01:18:32</span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* 06 · 按钮与状态语义 */}
      <section className="pd-band-light" style={{ borderTop: "1px solid var(--pulse-line-light)" }}>
        <div className="pd-wrap">
          <div className="pd-eyebrow"><span>06 / 按钮 · 状态语义（品牌红 ≠ 错误红）</span></div>
          <h2 className="pd-h2">动作、危险与结果分离</h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.75rem" }}>
            <button className="pd-btn pd-btn--primary" type="button">开始预测</button>
            <button className="pd-btn pd-btn--outline" type="button">创建房间</button>
            <button className="pd-btn pd-btn--danger" type="button">⚠ 解散房间</button>
            <button className="pd-btn pd-btn--ghost" type="button">查看规则</button>
          </div>
          <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
            <span className="pd-status pd-status--error">✕ 积分不足，本次提交未生效</span>
            <span className="pd-status pd-status--success">✓ 结算完成 +6,400</span>
            <span className="pd-status pd-status--locked">🔒 已封盘 · 保留你的选择</span>
            <span className="pd-tag pd-tag--lime"><span>LIVE</span></span>
            <span className="pd-tag"><span>Q1 开始封盘</span></span>
            <span className="pd-tag pd-tag--ghost"><span>已结束</span></span>
          </div>
          <p className="pd-slip-meta" style={{ marginTop: "3rem" }}>
            仅使用虚拟积分，不支持充值、提现或兑换。18 岁以上用户可使用。 · PULSE DESIGN SYSTEM v0.1 · SoT: docs/product/pulse-multisport-brand-ui-redesign.md
          </p>
        </div>
      </section>
    </main>
  );
}
