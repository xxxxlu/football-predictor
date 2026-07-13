import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminStatusView } from "@/features/operations/admin-status-view";
export const metadata: Metadata = { title: "系统状态" };
export default function AdminStatusPage() { return <PrivateShell title="系统状态" description="供应商额度、产品缓存、自动结算与后台任务的只读健康视图。"><AdminStatusView/></PrivateShell>; }
