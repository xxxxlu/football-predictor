"use client";

import { useCallback, useEffect, useState } from "react";

export interface UserDataSummary {
  userId: string;
  username: string;
  nickname: string | null;
  consentCount: number;
  dataCount: number;
  dataTypes: string[];
}

export interface UserDataDetail {
  consents: Array<{
    id: string;
    userId: string;
    dataType: string;
    consented: boolean;
    consentedAt: string;
    updatedAt: string;
  }>;
  collectedData: Array<{
    id: string;
    userId: string;
    dataType: string;
    data: unknown;
    collectedAt: string;
  }>;
}

export function useAdminPrivacyData() {
  const [users, setUsers] = useState<UserDataSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/admin/privacy/data", { credentials: "same-origin" });
        if (!response.ok) throw new Error("无法加载用户数据");
        const result = await response.json() as { data: UserDataSummary[] };
        if (!cancelled) setUsers(result.data.filter((u) => u.consentCount > 0 || u.dataCount > 0));
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message || "无法加载数据");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const refresh = useCallback(() => { setLoading(true); setError(""); setReload((value) => value + 1); }, []);

  const getUserDetail = async (userId: string): Promise<UserDataDetail | null> => {
    try {
      const response = await fetch(`/api/v1/admin/privacy/data/${userId}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("无法加载用户详情");
      const result = await response.json() as { data: UserDataDetail };
      return result.data;
    } catch {
      return null;
    }
  };

  return { users, loading, error, getUserDetail, refresh };
}