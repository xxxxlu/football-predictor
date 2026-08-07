"use client";

import { useState } from "react";

interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  connectionType: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
}

type NavigatorWithDeviceDetails = Navigator & {
  connection?: { effectiveType?: string };
  deviceMemory?: number;
};

export function PrivacyDeviceInfo({ onCollect, collected }: { onCollect: (info: object) => Promise<boolean>; collected: boolean }) {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [sent, setSent] = useState(false);

  const readDeviceInfo = (): DeviceInfo => {
    const extendedNavigator = navigator as NavigatorWithDeviceDetails;
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      connectionType: extendedNavigator.connection?.effectiveType || "unknown",
      deviceMemory: extendedNavigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  };

  const handleCollect = async () => {
    const currentInfo = readDeviceInfo();
    setInfo(currentInfo);
    setCollecting(true);
    setCollectError("");
    const succeeded = await onCollect(currentInfo);
    setSent(succeeded);
    if (!succeeded) setCollectError("设备信息提交失败，请检查网络后重试");
    setCollecting(false);
  };

  if (!collected) {
    return (
      <p className="text-xs text-[var(--muted)]">
        开启授权后，可收集设备信息用于优化展示。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-[var(--field)]">✓ 应用内设备信息授权已开启</p>
      {info && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">平台</span>
            <span className="font-medium">{info.platform}</span>
          </div>
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">语言</span>
            <span className="font-medium">{info.language}</span>
          </div>
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">屏幕</span>
            <span className="font-medium">{info.screenWidth}×{info.screenHeight}</span>
          </div>
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">时区</span>
            <span className="font-medium">{info.timezone}</span>
          </div>
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">连接类型</span>
            <span className="font-medium">{info.connectionType}</span>
          </div>
          <div className="rounded-lg bg-[var(--wash)] p-2">
            <span className="block text-[var(--muted)]">逻辑核心</span>
            <span className="font-medium">{info.hardwareConcurrency}</span>
          </div>
        </div>
      )}
      {collectError && <p role="alert" className="text-xs font-bold text-[var(--coral)]">{collectError}</p>}
      {sent && <p className="text-xs text-[var(--field)]">✓ 设备信息已提交</p>}
      <button
        type="button"
        disabled={collecting}
        onClick={handleCollect}
        className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-4 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-45"
      >
        {collecting ? "收集中…" : "立即收集设备信息"}
      </button>
    </div>
  );
}
