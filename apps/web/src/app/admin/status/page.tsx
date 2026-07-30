import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminStatusView } from "@/features/operations/admin-status-view";
export const metadata: Metadata = { title: "运营总览" };
export default function AdminStatusPage() {
  return <PrivateShell title="运营总览" description="供应商、结算与任务健康，待处理的举报与账户风险，以及可筛选的权限审计。">
    <AdminStatusView/>
  </PrivateShell>;
}
