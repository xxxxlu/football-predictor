"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";

export default function DesignV3Page() {
  const [activeOdds, setActiveOdds] = useState("1.45");
  const [activePick, setActivePick] = useState("BAYERN MUNICH (HOME)");
  const [stake, setStake] = useState(1000);
  const [score, setScore] = useState("2 : 1");
  const [isGoalScored, setIsGoalScored] = useState(false);
  const [showCurtain, setShowCurtain] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);

  const matchCardRef = useRef<HTMLDivElement>(null);
  const slipDockRef = useRef<HTMLDivElement>(null);

  // Mouse Follower & 3D Tilt Hook
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });

      // Match Card Tilt & Spotlight
      if (matchCardRef.current) {
        const rect = matchCardRef.current.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -6;
          const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 6;
          matchCardRef.current.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
          matchCardRef.current.style.setProperty("--mouse-x", `${x}px`);
          matchCardRef.current.style.setProperty("--mouse-y", `${y}px`);
        } else {
          matchCardRef.current.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)";
        }
      }

      // Slip Dock Tilt & Spotlight
      if (slipDockRef.current) {
        const rect = slipDockRef.current.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -5;
          const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 5;
          slipDockRef.current.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
          slipDockRef.current.style.setProperty("--mouse-x", `${x}px`);
          slipDockRef.current.style.setProperty("--mouse-y", `${y}px`);
        } else {
          slipDockRef.current.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)";
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleSimulateGoal = () => {
    if (isGoalScored) return;
    setIsGoalScored(true);
    setScore("3 : 1");
    setShowCurtain(true);
    setTimeout(() => setShowCurtain(false), 4200);
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
    }, 600);
  };

  const oddsVal = parseFloat(activeOdds) || 1;
  const payout = Math.round(stake * oddsVal);
  const profit = payout - stake;

  return (
    <div
      style={{
        backgroundColor: "#0B0C0E",
        minHeight: "100vh",
        color: "#FFFFFF",
        padding: "20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        cursor: "none",
        position: "relative",
      }}
    >
      {/* 1. Racing Red Magnetic Cursor */}
      <div
        style={{
          position: "fixed",
          top: cursorPos.y,
          left: cursorPos.x,
          width: 8,
          height: 8,
          backgroundColor: "#FF2A3B",
          borderRadius: "50%",
          pointerEvents: "none",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          boxShadow: "0 0 12px #FF2A3B",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: cursorPos.y,
          left: cursorPos.x,
          width: isHovered ? 56 : 34,
          height: isHovered ? 56 : 34,
          border: "1.5px solid rgba(255, 42, 59, 0.65)",
          backgroundColor: isHovered ? "rgba(255, 42, 59, 0.18)" : "transparent",
          borderRadius: "50%",
          pointerEvents: "none",
          transform: "translate(-50%, -50%)",
          zIndex: 9999,
          transition: "width 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s ease",
        }}
      />

      {/* 2. Top Event Curtain */}
      <div
        style={{
          position: "fixed",
          top: showCurtain ? 24 : -100,
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "#12151B",
          border: "1.5px solid #FF2A3B",
          borderRadius: 9999,
          padding: "12px 28px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.9), 0 0 30px rgba(255,42,59,0.35)",
          zIndex: 9998,
          transition: "all 0.45s cubic-bezier(0.65, 0.05, 0, 1)",
          opacity: showCurtain ? 1 : 0,
          pointerEvents: "none",
        }}
      >
        <span style={{ backgroundColor: "#FF2A3B", color: "#fff", fontWeight: 900, fontSize: 11, padding: "3px 10px", borderRadius: 9999 }}>
          ⚡ TELEMETRY FLASH
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
          BAYERN MUNICH // 85&apos; MUSIALA DRILLS INTO BOTTOM CORNER (3 - 1)
        </span>
      </div>

      <div style={{ maxWidth: 1220, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, position: "relative", zIndex: 10 }}>
        {/* Navigation */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            backgroundColor: "#121418",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 9999,
            boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ backgroundColor: "#FF2A3B", color: "#fff", fontWeight: 900, fontSize: 15, padding: "4px 12px", borderRadius: 9999, boxShadow: "0 0 16px rgba(255,42,59,0.4)" }}>
              PLS // RED
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.03em", textTransform: "uppercase" }}>
                PULSE MOTORSPORT
              </span>
              <span style={{ fontSize: 11, color: "#8F94A0", fontFamily: "monospace" }}>OFFICIAL HUB</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/" style={{ fontSize: 12, color: "#8F94A0", textDecoration: "none", textTransform: "uppercase", fontWeight: 800 }}>
              ← 返回主站
            </Link>
            <button
              onClick={handleSimulateGoal}
              style={{
                backgroundColor: "transparent",
                border: "1px solid rgba(255, 42, 59, 0.5)",
                color: "#FF2A3B",
                fontSize: 12,
                fontWeight: 900,
                textTransform: "uppercase",
                padding: "10px 22px",
                borderRadius: 9999,
                cursor: "pointer",
                transition: "all 0.25s ease",
              }}
            >
              ⚡ SIMULATE GOAL (进球更新)
            </button>
          </div>
        </header>

        {/* Ticker Tape */}
        <div
          style={{
            backgroundColor: "#090A0D",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: "10px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "monospace",
            fontSize: 12,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ backgroundColor: "#FF2A3B", color: "#fff", fontWeight: 900, fontSize: 10, padding: "2px 8px", borderRadius: 4 }}>
              ON AIR
            </span>
            <span style={{ color: "#E2E8F0", fontWeight: 600 }}>
              {isGoalScored
                ? "🚨 GOAL // BAYERN MUNICH 85' MUSIALA SCORES (3 - 1) — ALLIANZ ARENA"
                : "BUNDESLIGA // DER KLASSIKER — ALLIANZ ARENA (84')"}
            </span>
          </div>
          <div style={{ color: "#8F94A0", fontSize: 11 }}>
            <span>TRACK: <b>DRY</b></span> · <span>TEMP: <b>18°C</b></span> · <span style={{ color: "#FF2A3B" }}>TELEMETRY: LIVE</span>
          </div>
        </div>

        {/* Main Grid */}
        <main style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24, alignItems: "start" }}>
          {/* Left Column: Match Card & Scuderia Telemetry */}
          <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* 3D Tilt Match Card with Red Spotlight */}
            <article
              ref={matchCardRef}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              style={{
                backgroundColor: "#121418",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 24,
                padding: 26,
                display: "flex",
                flexDirection: "column",
                gap: 20,
                position: "relative",
                overflow: "hidden",
                transformStyle: "preserve-3d",
                transition: "transform 0.15s ease-out, border-color 0.3s ease, box-shadow 0.3s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  paddingBottom: 14,
                  fontSize: 12,
                  color: "#8F94A0",
                  textTransform: "uppercase",
                  fontFamily: "monospace",
                }}
              >
                <div>
                  <span style={{ color: "#FF2A3B", fontWeight: 800 }}>01 / FOOTBALL HEADLINE</span>
                  <span style={{ marginLeft: 8, color: "#fff", fontWeight: 700 }}>ROUND 27 · DER KLASSIKER</span>
                </div>
                <div>MUNICH, GERMANY</div>
              </div>

              {/* Confrontation */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  alignItems: "center",
                  gap: 20,
                  padding: "10px 0",
                }}
              >
                {/* Home */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 16,
                      backgroundColor: "#DC052D",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    FCB
                  </div>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                      BAYERN MUNICH
                    </div>
                    <div style={{ fontSize: 11, color: "#8F94A0", fontFamily: "monospace", marginTop: 2 }}>
                      POSSESSION 64% · XG 2.45
                    </div>
                  </div>
                </div>

                {/* Score */}
                <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      backgroundColor: "#000",
                      border: isGoalScored ? "1px solid #FF2A3B" : "1px solid rgba(255,255,255,0.1)",
                      boxShadow: isGoalScored ? "0 0 25px rgba(255,42,59,0.35)" : "none",
                      borderRadius: 18,
                      padding: "8px 24px",
                      transition: "all 0.3s ease",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: 44, fontWeight: 900, color: isGoalScored ? "#FF2A3B" : "#fff" }}>
                      {score}
                    </span>
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 800, color: "#FF2A3B", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    {isGoalScored ? "GOAL MOMENT // 85'" : "2ND HALF // 84'"}
                  </span>
                </div>

                {/* Away */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "flex-end", textAlign: "right" }}>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                      LEVERKUSEN
                    </div>
                    <div style={{ fontSize: 11, color: "#8F94A0", fontFamily: "monospace", marginTop: 2 }}>
                      COUNTER ATTACKS 7 · SHOTS 4
                    </div>
                  </div>
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 16,
                      backgroundColor: "#E32219",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    B04
                  </div>
                </div>
              </div>

              {/* Territory Bar */}
              <div
                style={{
                  backgroundColor: "#090A0E",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 14,
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                  <span>BAYERN DOMINANCE ({isGoalScored ? "74%" : "64%"})</span>
                  <span style={{ color: "#FF2A3B" }}>
                    {isGoalScored ? "MUSIALA CLINICAL FINISH TO BOTTOM CORNER" : "ATTACKING 18-YARD BOX"}
                  </span>
                  <span>LEVERKUSEN ({isGoalScored ? "26%" : "36%"})</span>
                </div>
                <div style={{ height: 6, backgroundColor: "#1C2028", borderRadius: 3, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: isGoalScored ? "74%" : "64%", backgroundColor: "#FF2A3B", transition: "width 0.6s ease", boxShadow: "0 0 10px rgba(255,42,59,0.5)" }} />
                  <div style={{ width: isGoalScored ? "26%" : "36%", backgroundColor: "#3A4050", transition: "width 0.6s ease" }} />
                </div>
              </div>

              {/* Odds Matrix */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                  <span>LIVE 1X2 MARKET TELEMETRY</span>
                  <span>MAX ALLOCATION: 20,000 PTS</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                  {[
                    { label: "HOME // 主胜", name: "BAYERN MUNICH (HOME)", odds: "1.45", trend: "▲ 0.03", trendColor: "#34D399" },
                    { label: "DRAW // 平局", name: "DRAW // 双方平局", odds: "4.10", trend: "PAR", trendColor: "#8F94A0" },
                    { label: "AWAY // 客胜", name: "LEVERKUSEN (AWAY)", odds: "6.80", trend: "▼ 0.20", trendColor: "#FF3B30" },
                  ].map((item) => {
                    const isSelected = activePick === item.name;
                    return (
                      <div
                        key={item.name}
                        onClick={() => {
                          setActivePick(item.name);
                          setActiveOdds(item.odds);
                        }}
                        style={{
                          backgroundColor: isSelected ? "#160809" : "#15181F",
                          border: isSelected ? "1px solid #FF2A3B" : "1px solid rgba(255,255,255,0.1)",
                          boxShadow: isSelected ? "0 0 0 1px #FF2A3B, 0 10px 30px rgba(255,42,59,0.22)" : "none",
                          borderRadius: 16,
                          padding: "18px 16px",
                          cursor: "pointer",
                          userSelect: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          transform: isSelected ? "translateY(-4px)" : "none",
                          transition: "all 0.25s cubic-bezier(0.65, 0.05, 0, 1)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: isSelected ? "#FF2A3B" : "#8F94A0" }}>
                          <span>{item.label}</span>
                          <span style={{ color: item.trendColor, fontFamily: "monospace" }}>{item.trend}</span>
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 32, fontWeight: 900, color: isSelected ? "#FF2A3B" : "#fff", letterSpacing: "-0.02em" }}>
                          {item.odds}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>

            {/* F1 Red Strip */}
            <article
              style={{
                backgroundColor: "#0B0D10",
                border: "1px solid rgba(255,255,255,0.1)",
                borderLeft: "4px solid #FF2A3B",
                borderRadius: 18,
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 16,
              }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: "#FF2A3B",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 16px rgba(255,42,59,0.4)",
                  }}
                >
                  #16
                </div>
                <div>
                  <h4 style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", margin: 0 }}>
                    SCUDERIA CORSA // F1 TELEMETRY
                  </h4>
                  <p style={{ fontSize: 11, color: "#8F94A0", fontFamily: "monospace", margin: "3px 0 0 0" }}>
                    MEXICAN GP · SPEED: 348.6 KM/H · TIRE: SOFT (76% WEAR) · DRS: OPEN
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setActivePick("SCUDERIA (P1 WIN)");
                  setActiveOdds("1.82");
                }}
                style={{
                  backgroundColor: activePick.includes("SCUDERIA") ? "#160809" : "#15181F",
                  border: activePick.includes("SCUDERIA") ? "1px solid #FF2A3B" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 14,
                  padding: "12px 20px",
                  cursor: "pointer",
                  color: "#fff",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#8F94A0" }}>P1 WINNER</div>
                <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: "#FF2A3B" }}>1.82</div>
              </button>
            </article>
          </section>

          {/* Right Column: Tactical Betslip Dock */}
          <aside
            ref={slipDockRef}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
              backgroundColor: "#121418",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 24,
              padding: 26,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              transformStyle: "preserve-3d",
              transition: "transform 0.15s ease-out, border-color 0.3s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: 16,
              }}
            >
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.02em", textTransform: "uppercase", margin: 0 }}>
                TACTICAL BETSLIP
              </h2>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 800, color: "#fff", backgroundColor: "#FF2A3B", padding: "3px 10px", borderRadius: 9999, boxShadow: "0 0 10px rgba(255,42,59,0.4)" }}>
                ● RACING RED ACTIVE
              </span>
            </div>

            {/* Target Plate */}
            <div
              style={{
                backgroundColor: "#090A0E",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                <span>ACTIVE SELECTION</span>
                <span>BUNDESLIGA ROUND 27</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase", color: "#fff" }}>
                  {activePick}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 900, color: "#FF2A3B" }}>
                  {activeOdds}
                </span>
              </div>
            </div>

            {/* Stake Allocation */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                <span>STAKE ALLOCATION (PTS)</span>
                <span>AVAILABLE: 14,250 PTS</span>
              </div>

              <div
                style={{
                  backgroundColor: "#090A0E",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 14,
                  padding: "12px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: "#555A66" }}>PTS //</span>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(Math.max(0, parseInt(e.target.value) || 0))}
                  style={{
                    backgroundColor: "transparent",
                    border: "none",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: 28,
                    fontWeight: 900,
                    textAlign: "right",
                    width: 140,
                    outline: "none",
                  }}
                />
              </div>

              {/* Fast Chips */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {[500, 1000, 2500, 5000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setStake(v)}
                    style={{
                      backgroundColor: stake === v ? "#FF2A3B" : "#090A0D",
                      color: "#fff",
                      border: stake === v ? "1px solid #FF2A3B" : "1px solid rgba(255,255,255,0.1)",
                      fontFamily: "monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "9px 0",
                      borderRadius: 9999,
                      cursor: "pointer",
                      textAlign: "center",
                      boxShadow: stake === v ? "0 0 12px rgba(255,42,59,0.35)" : "none",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {v === 5000 ? "MAX" : v.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Payout */}
            <div
              style={{
                backgroundColor: "rgba(255, 42, 59, 0.05)",
                border: "1px solid rgba(255, 42, 59, 0.3)",
                borderRadius: 16,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                  ESTIMATED PAYOUT
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 900, color: "#FF2A3B" }}>
                  {payout.toLocaleString()} PTS
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontFamily: "monospace", color: "#8F94A0", textTransform: "uppercase" }}>
                  NET PROFIT
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: "#34D399" }}>
                  +{profit.toLocaleString()} PTS
                </div>
              </div>
            </div>

            {/* Oversized Red Signature Pill Button */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || isSuccess}
              style={{
                width: "100%",
                padding: "18px 0",
                borderRadius: 9999,
                backgroundColor: isSuccess ? "#10B981" : "#FF2A3B",
                border: "none",
                color: "#fff",
                fontSize: 17,
                fontWeight: 900,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: isSubmitting || isSuccess ? "default" : "pointer",
                boxShadow: "0 10px 30px rgba(255,42,59,0.45)",
                transition: "all 0.25s cubic-bezier(0.65, 0.05, 0, 1)",
              }}
            >
              {isSubmitting
                ? "LOCKING TELEMETRY..."
                : isSuccess
                ? "✓ PREDICTION LOCKED (已幂等入账)"
                : "LOCK PREDICTION // 锁定预测 →"}
            </button>

            <p style={{ textAlign: "center", fontSize: 10, fontFamily: "monospace", color: "#555A66", letterSpacing: "0.05em", margin: 0 }}>
              IDEMPOTENT SNOWFLAKE VERIFIED · ZERO FLOATING LOSS · POSTGRES ROW LOCK
            </p>
          </aside>
        </main>
      </div>
    </div>
  );
}
