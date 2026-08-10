"use client";

import { useCallback, useEffect, useState } from "react";

export type DataType = "PHOTO" | "LOCATION" | "DEVICE_INFO" | "PREFERENCES";

export interface ConsentEntry {
  dataType: DataType;
  consented: boolean;
}

export interface CollectedDataEntry {
  id: string;
  userId: string;
  dataType: DataType;
  data: Record<string, unknown>;
  collectedAt: string;
}

export interface ConsentData {
  consents: ConsentEntry[];
  collectedData: CollectedDataEntry[];
}

export function usePrivacyConsent() {
  const [data, setData] = useState<ConsentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

  const fetchConsent = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/privacy/consent", { credentials: "same-origin" });
      if (!response.ok) {
        if (response.status === 401) throw new Error("请先登录");
        throw new Error("无法加载隐私设置");
      }
      const result = await response.json() as { data: ConsentData };
      setData(result.data);
    } catch (reason) {
      setError((reason as Error).message || "无法加载隐私设置");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchConsent(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchConsent]);

  const updateConsent = async (dataType: DataType, consented: boolean) => {
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/v1/privacy/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataType, consented }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(result.error?.message || "无法更新授权");
      }
      const result = await response.json() as { data: { dataType: DataType; consented: boolean } };
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          consents: prev.consents.map((c) =>
            c.dataType === result.data.dataType ? { ...c, consented: result.data.consented } : c,
          ),
        };
      });
      setSaved(`「${DATA_TYPE_LABELS[dataType]}」授权已更新`);
      return true;
    } catch (reason) {
      setError((reason as Error).message || "无法更新授权");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitDeviceInfo = async (info: object) => {
    try {
      const response = await fetch("/api/v1/privacy/device", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      });
      if (!response.ok) return false;
      await fetchConsent(false);
      return true;
    } catch {
      return false;
    }
  };

  const submitLocation = async (pos: object) => {
    try {
      const response = await fetch("/api/v1/privacy/location", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pos),
      });
      if (!response.ok) return false;
      await fetchConsent(false);
      return true;
    } catch {
      return false;
    }
  };

  const submitPhoto = async (photo: object) => {
    try {
      const response = await fetch("/api/v1/privacy/photo", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(photo),
      });
      if (!response.ok) return false;
      await fetchConsent(false);
      return true;
    } catch {
      return false;
    }
  };

  const submitPreferences = async (prefs: object) => {
    try {
      const response = await fetch("/api/v1/privacy/preferences", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!response.ok) return false;
      await fetchConsent(false);
      return true;
    } catch {
      return false;
    }
  };

  const clearCollectedData = async () => {
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/v1/privacy/data", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(result.error?.message || "无法清除已收集数据");
      }
      setData((prev) => prev ? { ...prev, collectedData: [] } : prev);
      setSaved("已清除全部已收集数据");
      return true;
    } catch (reason) {
      setError((reason as Error).message || "无法清除已收集数据");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    data, loading, error, saving, saved,
    setError, setSaved,
    updateConsent, submitDeviceInfo, submitLocation, submitPhoto, submitPreferences,
    clearCollectedData, refresh: fetchConsent,
  };
}

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  PHOTO: "相册与照片",
  LOCATION: "位置信息",
  DEVICE_INFO: "设备信息",
  PREFERENCES: "用户偏好",
};

export const DATA_TYPE_DESCRIPTIONS: Record<DataType, string> = {
  PHOTO: "仅在你主动选择照片或拍照时提交；手机系统仍会单独显示选择或权限界面。",
  LOCATION: "仅在你主动使用地区功能并通过手机系统确认后获取，不会持续后台定位。",
  DEVICE_INFO: "登录时自动记录浏览器、平台、屏幕、语言、时区、网络与基础性能信息，用于手机适配和兼容性分析。",
  PREFERENCES: "登录时自动记录语言、主题、显示辅助设置、通知状态和关注赛事，让体验保持一致。",
};

export const DATA_TYPE_ICONS: Record<DataType, string> = {
  PHOTO: "📷",
  LOCATION: "📍",
  DEVICE_INFO: "📱",
  PREFERENCES: "⚙️",
};
