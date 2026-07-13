import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminUsersView } from "@/features/operations/admin-users-view";
export const metadata: Metadata = { title: "用户状态管理" };
export default function AdminUsersPage() { return <PrivateShell title="用户状态管理" description="超级管理员可以禁用或恢复普通用户；敏感操作前必须重新确认身份。"><AdminUsersView/></PrivateShell>; }
