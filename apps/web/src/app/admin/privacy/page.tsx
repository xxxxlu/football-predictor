import type { Metadata } from "next";
import { AdminPrivacyView } from "@/features/admin/privacy/admin-privacy-view";
import { PrivateShell } from "@/features/matchday/private-shell";

export const metadata: Metadata = { title: "隐私数据管理" };

export default function AdminPrivacyPage() {
  return (
    <PrivateShell title="隐私数据管理" description="查看所有用户的授权与数据收集情况。">
      <AdminPrivacyView />
    </PrivateShell>
  );
}