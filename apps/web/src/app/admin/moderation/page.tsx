import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminModerationView } from "@/features/operations/admin-moderation-view";
export const metadata: Metadata={title:"房间治理"};
export default function AdminModerationPage(){return <PrivateShell title="房间治理" description="查看举报、限制或关闭房间，并核对操作审计。"><AdminModerationView/></PrivateShell>;}
