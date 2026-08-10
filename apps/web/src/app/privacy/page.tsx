import type { Metadata } from "next";
import { PrivacyConsentView } from "@/features/privacy/privacy-consent-view";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "隐私与授权" };

export default function PrivacyPage() {
  return (
    <PrivateShell title="隐私与授权" description="查看授权状态、撤销后续收集或清除历史数据。">
      <PrivacyConsentView />
    </PrivateShell>
  );
}
