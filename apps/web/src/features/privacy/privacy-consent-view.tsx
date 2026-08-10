"use client";

import Link from "next/link";
import {
  DATA_TYPE_LABELS,
  usePrivacyConsent,
  type CollectedDataEntry,
  type DataType,
} from "./privacy-consent-flow";
import { PrivacyConsentCard } from "./privacy-consent-card";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";

const DATA_TYPES: DataType[] = ["PHOTO", "LOCATION", "DEVICE_INFO", "PREFERENCES"];

export function PrivacyConsentView() {
  const {
    data, loading, error, saving, saved,
    setError, setSaved, updateConsent, clearCollectedData,
  } = usePrivacyConsent();

  const consentMap = new Map<DataType, boolean>(
    (data?.consents ?? []).map((consent) => [consent.dataType, consent.consented]),
  );
  const collectedMap = new Map<DataType, CollectedDataEntry[]>();
  for (const entry of data?.collectedData ?? []) {
    const existing = collectedMap.get(entry.dataType) ?? [];
    existing.push(entry);
    collectedMap.set(entry.dataType, existing);
  }

  if (loading) return <DataStatePanel state="loading" title="加载隐私设置" description="" />;

  const anyConsented = DATA_TYPES.some((dataType) => consentMap.get(dataType));
  const hasCollectedData = Boolean(data?.collectedData.length);

  const handleRevoke = async (dataType: DataType) => {
    if (!window.confirm(`撤销「${DATA_TYPE_LABELS[dataType]}」后，系统将停止后续收集；历史记录不会自动删除。是否继续？`)) return;
    await updateConsent(dataType, false);
  };

  const handleRevokeAll = async () => {
    if (!window.confirm("撤销全部授权后，系统将停止后续收集；历史记录不会自动删除。是否继续？")) return;
    setError("");
    for (const dataType of DATA_TYPES) {
      if (consentMap.get(dataType) && !await updateConsent(dataType, false)) return;
    }
    setSaved("已撤销全部应用内数据授权");
  };

  const handleClearCollectedData = async () => {
    if (!window.confirm("这会永久删除隐私中心保存的全部已收集数据，但不会改变当前授权状态。是否继续？")) return;
    await clearCollectedData();
  };

  return (
    <div className="space-y-8">
      <section className="surface rounded-xl p-5 sm:p-7">
        <p className="eyebrow">PRIVACY & PERMISSIONS</p>
        <h2 className="display mt-1 text-2xl font-bold">隐私与授权中心</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          基础授权在你登录时完成，设备与显示偏好会随登录自动提交，不需要再次点击。本页用于查看当前状态、撤销后续收集和清除历史数据。
        </p>
        <Link href="/privacy-policy" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4">
          查看隐私政策
        </Link>
      </section>

      {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}
      {saved && <StatusMessage tone="success" title={saved} />}

      <div className="grid gap-4">
        {DATA_TYPES.map((dataType) => (
          <PrivacyConsentCard
            key={dataType}
            dataType={dataType}
            consented={consentMap.get(dataType) ?? false}
            disabled={saving}
            onRevoke={handleRevoke}
          />
        ))}
      </div>

      <section className="surface rounded-xl p-5 sm:p-7">
        <p className="eyebrow">COLLECTED DATA</p>
        <h3 className="display mt-1 text-xl font-bold">已收集数据总览</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">最近保存的授权数据记录，最多显示 100 条。</p>
        <div className="mt-4 space-y-3">
          {DATA_TYPES.map((dataType) => {
            const items = collectedMap.get(dataType);
            return (
              <div key={dataType} className="rounded-lg border border-[var(--line)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold">{DATA_TYPE_LABELS[dataType]}</span>
                  <span className="text-xs text-[var(--muted)]">{items ? `${items.length} 条记录` : "暂无数据"}</span>
                </div>
                {items && items.length > 0 && (
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted)] hover:text-[var(--ink)]">查看详情</summary>
                    <div className="max-h-56 space-y-2 overflow-auto rounded bg-[var(--wash)] p-3 text-xs">
                      {items.map((item) => (
                        <div key={item.id} className="border-b border-[var(--line)] pb-2 last:border-0 last:pb-0">
                          <p className="font-bold">{new Date(item.collectedAt).toLocaleString()}</p>
                          <p className="mt-1 break-words text-[var(--muted)]">{describeCollectedData(dataType, item.data)}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>

        <details className="mt-5 border-t border-[var(--line)] pt-3">
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted)] hover:text-[var(--ink)]">更多隐私操作</summary>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pb-2">
            <button type="button" disabled={saving || !anyConsented} onClick={handleRevokeAll} className="inline-flex min-h-11 items-center text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--coral)] disabled:opacity-40">撤销全部后续收集</button>
            <button type="button" disabled={saving || !hasCollectedData} onClick={handleClearCollectedData} className="inline-flex min-h-11 items-center text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--coral)] disabled:opacity-40">清除全部历史数据</button>
          </div>
        </details>
      </section>
    </div>
  );
}

function describeCollectedData(dataType: DataType, data: Record<string, unknown>) {
  const text = (value: unknown, fallback = "未知") => typeof value === "string" && value ? value : fallback;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

  if (dataType === "PHOTO") {
    const size = number(data.fileSize);
    return `文件：${text(data.fileName, "未命名图片")} · 类型：${text(data.fileType)}${size ? ` · ${(size / 1024).toFixed(0)} KB` : ""}`;
  }
  if (dataType === "LOCATION") {
    const latitude = number(data.latitude);
    const longitude = number(data.longitude);
    const accuracy = number(data.accuracy);
    return latitude !== undefined && longitude !== undefined
      ? `纬度 ${latitude.toFixed(4)} · 经度 ${longitude.toFixed(4)}${accuracy !== undefined ? ` · 精度约 ${accuracy.toFixed(0)} 米` : ""}`
      : "位置记录";
  }
  if (dataType === "DEVICE_INFO") {
    const width = number(data.screenWidth);
    const height = number(data.screenHeight);
    return `平台：${text(data.platform)} · 语言：${text(data.language)} · 时区：${text(data.timezone)}${width && height ? ` · 屏幕：${width}×${height}` : ""} · 网络：${text(data.connectionType)}`;
  }
  return `主题：${text(data.theme)} · 语言：${text(data.locale)} · 时区：${text(data.timezone)} · 运行方式：${text(data.displayMode)}`;
}
