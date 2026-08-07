import type { Metadata } from "next";
import { PrivacyConsentView } from "@/features/privacy/privacy-consent-view";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "隐私与授权" };

export default function PrivacyPage() {
  return (
    <PrivateShell title="隐私与授权" description="管理你的数据收集授权，查看已收集的数据。">
      <PrivacyConsentView />
    </PrivateShell>
  );
}