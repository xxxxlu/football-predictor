"use client";

import { useMemo, useState } from "react";
import { PulseHeader, MobileBottomNav } from "../components";

type Role = "GK" | "DEF" | "MID" | "FWD";
type Player = { id: number; name: string; number: number; role: Role; x: number; y: number; starter?: boolean; status?: string };

const roleLabel: Record<Role, string> = { GK: "门将", DEF: "后卫", MID: "中场", FWD: "前锋" };
const roleColor: Record<Role, string> = { GK: "#b4e36b", DEF: "#ff5a3d", MID: "#ffb34a", FWD: "#fae84e" };
const home: Player[] = [
  { id: 1, name: "Raya", number: 22, role: "GK", x: 9, y: 50 },
  { id: 2, name: "White", number: 4, role: "DEF", x: 25, y: 16 }, { id: 3, name: "Saliba", number: 2, role: "DEF", x: 25, y: 39 }, { id: 4, name: "Gabriel", number: 6, role: "DEF", x: 25, y: 61 }, { id: 5, name: "Timber", number: 12, role: "DEF", x: 25, y: 84 },
  { id: 6, name: "Ødegaard", number: 8, role: "MID", x: 45, y: 24 }, { id: 7, name: "Partey", number: 5, role: "MID", x: 45, y: 50 }, { id: 8, name: "Rice", number: 41, role: "MID", x: 45, y: 76 },
  { id: 9, name: "Saka", number: 7, role: "FWD", x: 69, y: 17 }, { id: 10, name: "Havertz", number: 29, role: "FWD", x: 69, y: 50 }, { id: 11, name: "Martinelli", number: 11, role: "FWD", x: 69, y: 83 },
];
const away: Player[] = [
  { id: 12, name: "Ederson", number: 31, role: "GK", x: 91, y: 50 },
  { id: 13, name: "Walker", number: 2, role: "DEF", x: 75, y: 18 }, { id: 14, name: "Dias", number: 3, role: "DEF", x: 75, y: 50 }, { id: 15, name: "Gvardiol", number: 24, role: "DEF", x: 75, y: 82 },
  { id: 16, name: "Rodri", number: 16, role: "MID", x: 57, y: 20 }, { id: 17, name: "Kovacic", number: 8, role: "MID", x: 57, y: 40 }, { id: 18, name: "Bernardo", number: 20, role: "MID", x: 57, y: 61 }, { id: 19, name: "Doku", number: 11, role: "MID", x: 57, y: 81 },
  { id: 20, name: "Foden", number: 47, role: "FWD", x: 35, y: 27 }, { id: 21, name: "Haaland", number: 9, role: "FWD", x: 35, y: 50 }, { id: 22, name: "Grealish", number: 10, role: "FWD", x: 35, y: 73 },
];
const substitutes = [{ name: "Jorginho", number: 20, role: "MID" as Role }, { name: "Trossard", number: 19, role: "FWD" as Role }, { name: "Akanji", number: 25, role: "DEF" as Role }, { name: "De Bruyne", number: 17, role: "MID" as Role }];

function initials(name: string) { return name.slice(0, 2).toUpperCase(); }

export function FootballMatchMap() {
  const [filter, setFilter] = useState<Role | "ALL">("ALL");
  const [selected, setSelected] = useState<Player | null>(home[9]);
  const players = useMemo(() => [...home, ...away].filter((player) => filter === "ALL" || player.role === filter), [filter]);
  return (
    <div className="pulse-scope pd-band-light pd-has-bottom-nav" style={{ minHeight: "100vh" }}>
      <PulseHeader active="赛事" />
      <main id="main-content">
        <section className="pd-foot-match-hero"><div className="pd-wrap">
          <div className="pd-eyebrow"><span>FOOTBALL / MATCH MAP</span><span className="pd-live-badge"><i className="pd-blink" />LIVE 67′</span></div>
          <div className="pd-foot-scoreline"><div><b>阿森纳</b><small>ARSENAL</small></div><strong>2 — 1</strong><div style={{ textAlign: "right" }}><b>曼城</b><small>MANCHESTER CITY</small></div></div>
          <p className="pd-note">英超 · Emirates Stadium · 官方首发 · 数据更新于 21:14</p>
        </div></section>

        <section className="pd-wrap pd-foot-map-layout">
          <div className="pd-foot-pitch-wrap">
            <div className="pd-foot-map-head"><div className="pd-eyebrow"><span>01 / LIVE XI</span><span>4-3-3 <em>vs</em> 3-4-3</span></div><div className="pd-foot-filters">{(["ALL", "GK", "DEF", "MID", "FWD"] as const).map((key) => <button key={key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>{key === "ALL" ? "全部" : roleLabel[key]}</button>)}</div></div>
            <div className="pd-foot-pitch" aria-label="阿森纳与曼城实时阵型地图">
              <div className="pd-foot-half-line" /><div className="pd-foot-center-circle" /><div className="pd-foot-box pd-foot-box--left" /><div className="pd-foot-box pd-foot-box--right" />
              {players.map((player) => <button key={player.id} type="button" className={`pd-foot-player ${player.id > 11 ? "is-away" : ""} ${selected?.id === player.id ? "is-selected" : ""}`} style={{ left: `${player.x}%`, top: `${player.y}%`, borderColor: roleColor[player.role] }} onClick={() => setSelected(player)} aria-label={`${player.number}号 ${player.name}，${roleLabel[player.role]}`}><span className="pd-foot-avatar">{initials(player.name)}</span><b>{player.number}</b><small>{player.name}</small></button>)}
              <div className="pd-foot-direction pd-foot-direction--left">ARS</div><div className="pd-foot-direction pd-foot-direction--right">MCI</div>
            </div>
            <p className="pd-slip-meta">球员位置来自官方 grid；颜色同时用于位置识别，不依赖头像。</p>
          </div>

          <aside className="pd-foot-sidebar">
            <div className="pd-foot-card"><div className="pd-eyebrow"><span>PLAYER FOCUS</span></div>{selected ? <><div className="pd-foot-focus"><span className="pd-foot-focus-avatar">{initials(selected.name)}</span><div><b>{selected.name}</b><small>#{selected.number} · {roleLabel[selected.role]} · 首发</small></div></div><div className="pd-foot-mini-stats"><span><b>67′</b><small>出场</small></span><span><b>{selected.role === "FWD" ? "2" : "—"}</b><small>关键事件</small></span><span><b>LIVE</b><small>状态</small></span></div></> : <p className="pd-note">点击球员查看详情</p>}</div>
            <div className="pd-foot-card"><div className="pd-eyebrow"><span>BENCH / 替补</span></div><div className="pd-foot-bench">{substitutes.map((sub) => <div key={sub.name}><span className="pd-foot-bench-avatar">{initials(sub.name)}</span><span><b>{sub.number} · {sub.name}</b><small>{roleLabel[sub.role]}</small></span></div>)}</div></div>
            <div className="pd-foot-card"><div className="pd-eyebrow"><span>MATCH EVENTS</span></div><div className="pd-foot-events"><div><b>64′</b><span>⚽ 哈弗茨 <small>阿森纳 2–1</small></span></div><div><b>58′</b><span>↔ 德布劳内 <small>换下科瓦契奇</small></span></div><div><b>31′</b><span>⚠ 罗德里 <small>黄牌</small></span></div></div></div>
          </aside>
        </section>
      </main>
      <MobileBottomNav active="赛事" />
    </div>
  );
}
