import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminUsersView } from "@/features/operations/admin-users-view";
export const metadata: Metadata = { title: "用户安全与生命周期" };
export default function AdminUsersPage() { return <PrivateShell title="用户安全与生命周期" description="搜索账户、查看安全概览与操作时间线；禁用、撤销会话与匿名化都需要重新确认身份并填写理由。"><AdminUsersView/></PrivateShell>; }
