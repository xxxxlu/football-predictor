"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { buildVictoryShareText, formatShareTitle } from "./share-text";
import { exportCanvasAsBlob, renderVictoryCardToCanvas } from "./share-canvas";
import type { VictoryCardData } from "./types";

export function VictoryShareModal({
  data,
  isOpen,
  onClose,
}: {
  data: VictoryCardData | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Render canvas whenever data changes or modal opens
  useEffect(() => {
    if (!isOpen || !data || !canvasRef.current) return;
    renderVictoryCardToCanvas(canvasRef.current, data);
  }, [isOpen, data]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  const title = formatShareTitle({ data, locale });
  const shareText = buildVictoryShareText({ data, locale });

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback
    }
  }

  async function handleDownloadImage() {
    if (!canvasRef.current) return;
    setDownloading(true);
    try {
      const blob = await exportCanvasAsBlob(canvasRef.current);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = data?.kind === "MATCH"
        ? `pulse-victory-${data.ticketId}.png`
        : `pulse-season-${data?.seasonLabel || "record"}.png`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handleNativeShare() {
    setSharing(true);
    try {
      if (!canvasRef.current || typeof navigator.share !== "function") {
        await handleCopyText();
        return;
      }

      const blob = await exportCanvasAsBlob(canvasRef.current);
      const filename = data?.kind === "MATCH" ? `pulse-victory.png` : `pulse-season.png`;
      const file = blob ? new File([blob], filename, { type: "image/png" }) : null;

      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          text: shareText,
          files: [file],
        });
      } else {
        await navigator.share({
          title,
          text: shareText,
          url: window.location.href,
        });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        await handleCopyText();
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="战报海报分享"
      className="bottom-sheet-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="interactive-card night relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[#0B0D11] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--pulse-red)] animate-pulse" />
            <h2 className="text-sm font-extrabold tracking-wider text-white">战绩海报生成器 · FLEX CARD</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="pressable-btn size-8 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Live Card Preview Box */}
        <div className="mt-4 flex flex-1 flex-col items-center justify-center overflow-y-auto rounded-xl bg-black/40 p-3">
          <canvas
            ref={canvasRef}
            className="max-h-[58vh] w-auto max-w-full rounded-lg shadow-lg"
          />
        </div>

        {/* Action Toolbar */}
        <div className="mt-4 grid grid-cols-3 gap-2.5 pt-2">
          <button
            type="button"
            onClick={handleDownloadImage}
            disabled={downloading}
            className="pressable-btn flex min-h-11 flex-col items-center justify-center rounded-xl bg-white/10 px-2 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
          >
            <span className="text-base">💾</span>
            <span className="mt-0.5">{downloading ? "生成中…" : "保存海报"}</span>
          </button>

          <button
            type="button"
            onClick={handleNativeShare}
            disabled={sharing}
            className="pressable-btn flex min-h-11 flex-col items-center justify-center rounded-xl bg-[var(--pulse-red)] px-2 py-1.5 text-xs font-black text-white shadow-md transition hover:brightness-110"
          >
            <span className="text-base">📱</span>
            <span className="mt-0.5">{sharing ? "正在呼起…" : "一键分享"}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyText}
            className="pressable-btn flex min-h-11 flex-col items-center justify-center rounded-xl bg-white/10 px-2 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
          >
            <span className="text-base">{copied ? "✓" : "📋"}</span>
            <span className="mt-0.5">{copied ? "已复制！" : "复制文案"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
