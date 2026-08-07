"use client";

import { useState } from "react";

export function PrivacyLocation({ onCollect, collected }: { onCollect: (pos: object) => Promise<boolean>; collected: boolean }) {
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [sent, setSent] = useState(false);

  const getLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("你的浏览器不支持地理位置功能");
      return;
    }
    setCollecting(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const data = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        };
        setLocation({ latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy });
        const succeeded = await onCollect(data);
        setSent(succeeded);
        if (!succeeded) setGeoError("位置提交失败，请检查网络后重试");
        setCollecting(false);
      },
      (err) => {
        setGeoError(err.code === 1 ? "你拒绝了位置请求" : "无法获取位置信息");
        setCollecting(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30_000 },
    );
  };

  if (!collected) {
    return (
      <p className="text-xs text-[var(--muted)]">
        开启授权后，可以获取你的当前位置。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-[var(--field)]">✓ 应用内位置授权已开启</p>
      <p className="text-xs leading-5 text-[var(--muted)]">点击获取位置后，手机系统或浏览器仍会单独询问位置权限。</p>
      {location && (
        <div className="rounded-lg bg-[var(--wash)] p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[var(--muted)]">纬度</span>
              <span className="ml-1 font-medium">{location.latitude.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-[var(--muted)]">经度</span>
              <span className="ml-1 font-medium">{location.longitude.toFixed(4)}</span>
            </div>
            {location.accuracy && (
              <div className="col-span-2">
                <span className="text-[var(--muted)]">精度</span>
                <span className="ml-1 font-medium">约 {location.accuracy.toFixed(0)} 米</span>
              </div>
            )}
          </div>
        </div>
      )}
      {geoError && <p className="text-xs text-[var(--coral)]">{geoError}</p>}
      {!sent && (
        <button
          type="button"
          disabled={collecting}
          onClick={getLocation}
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-4 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-45"
        >
          {collecting ? "获取位置中…" : "获取当前位置"}
        </button>
      )}
      {sent && <p className="text-xs text-[var(--field)]">✓ 位置已提交</p>}
    </div>
  );
}
