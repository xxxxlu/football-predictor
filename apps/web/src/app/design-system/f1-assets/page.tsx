import type { Metadata } from "next";
import Image from "next/image";
import manifest from "../../../../public/design-system/f1/assets-manifest.json";
import { PulseHeader } from "../components";
import { CIRCUITS } from "../circuits";
import { F1GridExplorer } from "../f1-grid-explorer";
import "../pulse.css";

export const metadata: Metadata = {
  title: "PULSE · 2026 F1 素材库",
  robots: { index: false, follow: false },
};

export default function F1AssetsPage() {
  const circuits = Object.entries(CIRCUITS);

  return (
    <main id="main-content" className="pulse-scope pd-band-dark pd-assets-page">
      <PulseHeader active="赛事" />

      <section className="pd-f1-showcase">
        <div className="pd-f1-showcase-grid">
          <div className="pd-f1-showcase-copy">
            <div className="pd-eyebrow"><span>ON TRACK / 2026 GRID</span><span className="pd-tag pd-tag--lime"><span>LIVE SYSTEM</span></span></div>
            <h1 className="pd-f1-showcase-title">BUILT<br /><span>TO MOVE.</span></h1>
            <p>赛道、赛车、车手。把整个赛季变成一个可探索的动态档案。</p>
            <div className="pd-f1-showcase-actions"><a className="pd-btn pd-btn--primary" href="#drivers">查看车手 →</a><a className="pd-btn pd-btn--ghost" href="#circuits">浏览赛道</a></div>
          </div>
          <div className="pd-f1-showcase-media" aria-label="Lando Norris 与 McLaren 2026 赛车">
            <div className="pd-f1-showcase-orbit pd-f1-showcase-orbit--one" /><div className="pd-f1-showcase-orbit pd-f1-showcase-orbit--two" />
            <Image className="pd-f1-showcase-car" src="/design-system/f1/cars/2026mclarencarright.avif" alt="McLaren 2026 赛车" width={1200} height={675} priority />
            <Image className="pd-f1-showcase-driver" src="/design-system/f1/drivers/2026mclarenlannor01right.avif" alt="Lando Norris 2026 车手素材" width={1200} height={1500} priority />
            <span className="pd-f1-showcase-number">04</span>
          </div>
        </div>
        <div className="pd-f1-marquee" aria-hidden="true"><span>RACE WEEK · QUALIFY · LIGHTS OUT · FULL SEND · RACE WEEK · QUALIFY · LIGHTS OUT · FULL SEND · </span></div>
      </section>

      <section className="pd-wrap">
        <div className="pd-eyebrow"><span>2026 / F1 ASSET LIBRARY</span></div>
        <h1 className="pd-h2">赛道、赛车与车手</h1>
        <p className="pd-note">
          当前官方赛历快照 22 条赛道、11 款赛车、22 位车手。车手、车队和赛车媒体来自本地素材包；赛道图片按当前资产目录映射。
        </p>
        <div className="pd-assets-summary">
          <span><b>{circuits.length}</b> CIRCUITS</span>
          <span><b>{manifest.cars.length}</b> CARS</span>
          <span><b>{manifest.drivers.length}</b> DRIVERS</span>
          <span>UPDATED <b>{manifest.generatedAt.slice(0, 10)}</b></span>
        </div>
      </section>

      <section id="circuits" className="pd-wrap pd-assets-section">
        <div className="pd-eyebrow"><span>01 / CURRENT CIRCUITS</span></div>
        <h2 className="pd-h2">22 Rounds</h2>
        <div className="pd-circuit-gallery">
          {circuits.map(([key, circuit]) => (
            <article className="pd-circuit-tile" key={key}>
              <Image src={circuit.asset} alt={`${circuit.name} 赛道图`} width={400} height={320} sizes="(max-width: 767px) 50vw, 220px" />
              <div><code>{String(circuit.round).padStart(2, "0")}</code><b>{circuit.gp}</b><small>{circuit.name}</small></div>
            </article>
          ))}
        </div>
      </section>

      <section id="cars" className="pd-wrap pd-assets-section">
        <div className="pd-eyebrow"><span>02 / 2026 CARS</span></div>
        <h2 className="pd-h2">11 Constructors</h2>
        <div className="pd-car-gallery">
          {manifest.cars.map((car) => (
            <article className="pd-media-tile pd-media-tile--car" key={car.slug}>
              <Image src={`${car.localPath}?v=${manifest.generatedAt}`} alt={`${car.team} ${car.chassis}`} width={car.width} height={car.height} sizes="(max-width: 767px) 100vw, 50vw" />
              <div className="pd-media-tile-copy">
                <span><b>{car.chassis}</b><small>{car.team}</small></span>
                {car.source === "user-provided" ? <span className="pd-slip-meta">LOCAL ASSET · 待补充署名</span> : <a href={car.sourcePage} target="_blank" rel="noreferrer">{car.license} · SOURCE ↗</a>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="drivers" className="pd-wrap pd-assets-section">
        <div className="pd-eyebrow"><span>03 / 2026 GRID</span></div>
        <h2 className="pd-h2">22 Drivers</h2>
        <F1GridExplorer />
      </section>

      <footer className="pd-wrap pd-assets-footer">
        完整作者、Credit、原图地址和许可证地址见 <code>/design-system/f1/assets-manifest.json</code>。
      </footer>
    </main>
  );
}
