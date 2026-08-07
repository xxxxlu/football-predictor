"use client";

import { useState } from "react";

export function PrivacyPreferences({ onCollect, collected }: { onCollect: (prefs: object) => Promise<boolean>; collected: boolean }) {
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const collectPreferences = async () => {
    setSaving(true);
    setSaveError("");
    const preferences = {
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      fontSize: getComputedStyle(document.documentElement).fontSize,
      sportPreferences: ["football"],
      notificationEnabled: "Notification" in window && Notification.permission === "granted",
    };
    const succeeded = await onCollect(preferences);
    setSent(succeeded);
    if (!succeeded) setSaveError("偏好提交失败，请检查网络后重试");
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      {collected ? (
        <>
          <p className="text-xs font-bold text-[var(--field)]">✓ 应用内偏好授权已开启</p>
          <p className="text-xs text-[var(--muted)]">
            点击保存后才会提交当前语言、主题、时区和通知状态。
          </p>
          {saveError && <p role="alert" className="text-xs font-bold text-[var(--coral)]">{saveError}</p>}
          {sent && <p className="text-xs text-[var(--field)]">✓ 偏好已保存</p>}
          <button
            type="button"
            disabled={saving}
            onClick={collectPreferences}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-4 text-xs font-bold text-white transition hover:brightness-95 disabled:opacity-45"
          >
            {saving ? "保存中…" : "保存当前偏好"}
          </button>
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          开启授权后，可选择保存语言、主题、时区和关注赛事等偏好。
        </p>
      )}
    </div>
  );
}
