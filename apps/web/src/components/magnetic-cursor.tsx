"use client";

import { useEffect, useState } from "react";

export function MagneticCursor() {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  const [ringPos, setRingPos] = useState({ x: -100, y: -100 });
  const [isHover, setIsHover] = useState(false);
  const [isTouch] = useState(() => typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches);

  useEffect(() => {
    if (isTouch) return;

    let targetX = -100;
    let targetY = -100;
    let currentX = -100;
    let currentY = -100;
    let activeCard: HTMLElement | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      setPos({ x: e.clientX, y: e.clientY });

      const target = e.target as HTMLElement | null;

      // 3D Perspective Tilt & Radial Spotlight for any .tilt-card
      const card = target?.closest<HTMLElement>(".tilt-card");
      if (card) {
        if (activeCard && activeCard !== card) {
          activeCard.style.transform = "";
        }
        activeCard = card;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -5;
        const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 5;
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
      } else if (activeCard) {
        activeCard.style.transform = "";
        activeCard = null;
      }

      // Magnetic hover target detection
      if (
        target?.closest(
          "button, a, .odds-tile, .tilt-card, .scoreboard-cell, input, select, textarea, [role='button'], .pressable-btn, .pd-sport-pill"
        )
      ) {
        setIsHover(true);
      } else {
        setIsHover(false);
      }
    };

    const handleMouseLeave = () => {
      if (activeCard) {
        activeCard.style.transform = "";
        activeCard = null;
      }
      setIsHover(false);
    };

    let animId: number;
    const render = () => {
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      setRingPos({ x: currentX, y: currentY });
      animId = requestAnimationFrame(render);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);
    animId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      cancelAnimationFrame(animId);
      if (activeCard) {
        activeCard.style.transform = "";
      }
    };
  }, [isTouch]);

  if (isTouch) return null;

  return (
    <>
      {/* Center Dot */}
      <div
        className="pointer-events-none fixed z-[99999] rounded-full"
        style={{
          top: pos.y,
          left: pos.x,
          width: 8,
          height: 8,
          backgroundColor: "#FF2A3B",
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 12px #FF2A3B",
        }}
      />
      {/* Outer Spring Ring */}
      <div
        className="pointer-events-none fixed z-[99998] rounded-full transition-[width,height,background-color] duration-200"
        style={{
          top: ringPos.y,
          left: ringPos.x,
          width: isHover ? 54 : 32,
          height: isHover ? 54 : 32,
          border: "1.5px solid rgba(255, 42, 59, 0.65)",
          backgroundColor: isHover ? "rgba(255, 42, 59, 0.16)" : "transparent",
          transform: "translate(-50%, -50%)",
        }}
      />
    </>
  );
}
