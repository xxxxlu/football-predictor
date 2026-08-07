"use client";

import { useState } from "react";
import { useAdminPrivacyData, type UserDataDetail } from "./admin-privacy-flow";
import { DataStatePanel } from "@/components/data-state-panel";

export function AdminPrivacyView() {
  const { users, loading, error, getUserDetail } = useAdminPrivacyData();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDataDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleSelectUser = async (userId: string) => {
    setSelectedUser(userId);
    setDetailLoading(true);
    setUserDetail(null);
    const detail = await getUserDetail(userId);
    setUserDetail(detail);
    setDetailLoading(false);
  };

  if (loading) {
    return <DataStatePanel state="loading" title="加载数据" description="" />;
  }

  if (error) {
    return <DataStatePanel state="error" title="无法加载数据" description={error} />;
  }

  const totalConsented = users.reduce((sum, u) => sum + u.consentCount, 0);
  const totalData = users.reduce((sum, u) => sum + u.dataCount, 0);

  return (
    <div className="space-y-8">
      {/* Stats Overview */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="surface rounded-xl p-5">
          <p className="text-xs font-bold text-[var(--muted)]">已授权用户</p>
          <p className="mt-1 text-3xl font-bold">{users.length}</p>
        </div>
        <div className="surface rounded-xl p-5">
          <p className="text-xs font-bold text-[var(--muted)]">总授权项数</p>
          <p className="mt-1 text-3xl font-bold">{totalConsented}</p>
        </div>
        <div className="surface rounded-xl p-5">
          <p className="text-xs font-bold text-[var(--muted)]">总数据条数</p>
          <p className="mt-1 text-3xl font-bold">{totalData}</p>
        </div>
      </div>

      {/* User List */}
      <div className="surface rounded-xl overflow-hidden">
        <div className="border-b border-[var(--line)] p-4">
          <h3 className="font-bold">用户数据列表</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            点击用户查看详细授权和数据
          </p>
        </div>
        {users.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">
            暂无用户授权数据
          </div>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {users.map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => handleSelectUser(user.userId)}
                className={`w-full px-4 py-3 text-left text-sm transition hover:bg-[var(--wash)] ${
                  selectedUser === user.userId ? "bg-[var(--wash)]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold">{user.nickname || user.username}</span>
                    <span className="ml-2 text-[var(--muted)]">@{user.username}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-[var(--muted)]">
                    <span>授权: {user.consentCount}</span>
                    <span>数据: {user.dataCount}</span>
                  </div>
                </div>
                {user.dataTypes.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {user.dataTypes.map((dt) => (
                      <span key={dt} className="rounded-full bg-[var(--field)]/10 px-2 py-0.5 text-[10px] text-[var(--field)]">
                        {dt}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User Detail */}
      {selectedUser && (
        <div className="surface rounded-xl p-5 sm:p-7">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">用户数据详情</h3>
            <button
              type="button"
              onClick={() => { setSelectedUser(null); setUserDetail(null); }}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
            >
              关闭
            </button>
          </div>

          {detailLoading ? (
            <div className="mt-4 text-center text-sm text-[var(--muted)]">加载中…</div>
          ) : userDetail ? (
            <div className="mt-4 space-y-6">
              {/* Consents */}
              <div>
                <p className="eyebrow text-xs">CONSENTS</p>
                <div className="mt-2 space-y-2">
                  {userDetail.consents.map((c) => (
                    <div key={c.dataType} className="flex items-center justify-between rounded-lg border border-[var(--line)] p-3">
                      <span className="text-sm font-medium">{c.dataType}</span>
                      <span className={`text-xs font-bold ${c.consented ? "text-[var(--field)]" : "text-[var(--coral)]"}`}>
                        {c.consented ? "✓ 已授权" : "✗ 未授权"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Collected Data */}
              <div>
                <p className="eyebrow text-xs">COLLECTED DATA</p>
                <div className="mt-2 space-y-2">
                  {userDetail.collectedData.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">暂无收集数据</p>
                  ) : (
                    userDetail.collectedData.map((d) => (
                      <details key={d.id} className="rounded-lg border border-[var(--line)]">
                        <summary className="cursor-pointer p-3 text-sm font-medium">
                          {d.dataType} · {new Date(d.collectedAt).toLocaleString("zh-CN")}
                        </summary>
                        <pre className="max-h-60 overflow-auto border-t border-[var(--line)] p-3 text-xs">
                          {JSON.stringify(d.data, null, 2)}
                        </pre>
                      </details>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--coral)]">无法加载用户详情</p>
          )}
        </div>
      )}
    </div>
  );
}