"use client";

import {
  DATA_TYPE_LABELS,
  usePrivacyConsent,
  type CollectedDataEntry,
  type DataType,
} from "./privacy-consent-flow";
import { PrivacyConsentCard } from "./privacy-consent-card";
import { PrivacyDeviceInfo } from "./privacy-device-info";
import { PrivacyLocation } from "./privacy-location";
import { PrivacyPhotoUpload } from "./privacy-photo-upload";
import { PrivacyPreferences } from "./privacy-preferences";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";

const DATA_TYPES: DataType[] = ["PHOTO", "LOCATION", "DEVICE_INFO", "PREFERENCES"];

export function PrivacyConsentView() {
  const {
    data, loading, error, saving, saved,
    setError, setSaved,
    updateConsent, submitDeviceInfo, submitLocation, submitPhoto, submitPreferences, clearCollectedData,
  } = usePrivacyConsent();

  const handleToggle = async (dataType: DataType, value: boolean) => {
    await updateConsent(dataType, value);
  };

  const consentMap = new Map<DataType, boolean>(
    (data?.consents ?? []).map((c) => [c.dataType, c.consented]),
  );

  const collectedMap = new Map<DataType, CollectedDataEntry[]>();
  for (const entry of data?.collectedData ?? []) {
    const existing = collectedMap.get(entry.dataType) ?? [];
    existing.push(entry);
    collectedMap.set(entry.dataType, existing);
  }

  if (loading) {
    return <DataStatePanel state="loading" title="加载隐私设置" description="" />;
  }

  const allConsented = DATA_TYPES.every((dt) => consentMap.get(dt));
  const anyConsented = DATA_TYPES.some((dt) => consentMap.get(dt));

  const handleConsentAll = async () => {
    setError("");
    for (const dt of DATA_TYPES) {
      if (!consentMap.get(dt)) {
        if (!await updateConsent(dt, true)) return;
      }
    }
    setSaved("已开启全部应用内数据授权");
  };

  const handleRevokeAll = async () => {
    setError("");
    for (const dt of DATA_TYPES) {
      if (consentMap.get(dt)) {
        if (!await updateConsent(dt, false)) return;
      }
    }
    setSaved("已撤销全部应用内数据授权");
  };

  const handleClearCollectedData = async () => {
    if (!window.confirm("这会永久删除隐私中心保存的全部已收集数据，但不会改变授权开关。是否继续？")) return;
    await clearCollectedData();
  };

  const hasCollectedData = Boolean(data?.collectedData.length);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="surface rounded-xl p-5 sm:p-7">
          <p className="eyebrow">PRIVACY & PERMISSIONS</p>
          <h2 className="display mt-1 text-2xl font-bold">隐私与授权中心</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            在这里你可以管理应用内数据收集授权。照片和位置仍由手机系统或浏览器单独确认。
            撤销授权会停止后续收集；历史数据可在页面底部单独清除。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving || allConsented}
              onClick={handleConsentAll}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--field)] px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-45"
            >
              一键授权全部
            </button>
            <button
              type="button"
              disabled={saving || !anyConsented}
              onClick={handleRevokeAll}
              className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--coral)] px-5 text-sm font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-45"
            >
              一键撤销全部
            </button>
          </div>
        </div>
      </div>

      {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}
      {saved && <StatusMessage tone="success" title={saved} />}

      {/* Consent Cards */}
      <div className="grid gap-4">
        {DATA_TYPES.map((dataType) => {
          const consented = consentMap.get(dataType) ?? false;
          return (
            <PrivacyConsentCard
              key={dataType}
              dataType={dataType}
              consented={consented}
              disabled={saving}
              onToggle={handleToggle}
            >
              {dataType === "PHOTO" && consented && <PrivacyPhotoUpload collected onCollect={submitPhoto} />}
              {dataType === "LOCATION" && consented && <PrivacyLocation collected onCollect={submitLocation} />}
              {dataType === "DEVICE_INFO" && consented && <PrivacyDeviceInfo collected onCollect={submitDeviceInfo} />}
              {dataType === "PREFERENCES" && consented && <PrivacyPreferences collected onCollect={submitPreferences} />}
            </PrivacyConsentCard>
          );
        })}
      </div>

      {/* Collected Data Summary */}
      <div className="surface rounded-xl p-5 sm:p-7">
        <p className="eyebrow">COLLECTED DATA</p>
        <h3 className="display mt-1 text-xl font-bold">已收集数据总览</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          以下是你已授权并已收集的数据概览。
        </p>
        <div className="mt-4 space-y-3">
          {DATA_TYPES.map((dataType) => {
            const items = collectedMap.get(dataType);
            return (
              <div key={dataType} className="rounded-lg border border-[var(--line)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{DATA_TYPE_LABELS[dataType]}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {items ? `${items.length} 条记录` : "暂无数据"}
                  </span>
                </div>
                {items && items.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]">
                      查看详情
                    </summary>
                    <div className="mt-2 max-h-56 space-y-2 overflow-auto rounded bg-[var(--wash)] p-3 text-xs">
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
        <div className="mt-5 border-t border-[var(--line)] pt-5">
          <button
            type="button"
            disabled={saving || !hasCollectedData}
            onClick={handleClearCollectedData}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border-2 border-[var(--coral)] px-5 text-sm font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white disabled:opacity-45 sm:w-auto"
          >
            清除全部已收集数据
          </button>
        </div>
      </div>
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
    return `平台：${text(data.platform)} · 语言：${text(data.language)} · 时区：${text(data.timezone)}`;
  }
  return `主题：${text(data.theme)} · 语言：${text(data.locale)} · 时区：${text(data.timezone)}`;
}
