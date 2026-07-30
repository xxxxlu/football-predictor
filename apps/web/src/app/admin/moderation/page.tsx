import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminModerationView } from "@/features/operations/admin-moderation-view";
export const metadata: Metadata={title:"治理收件箱"};
export default function AdminModerationPage(){return <PrivateShell title="治理收件箱" description="处理职责范围内的举报，按最小上下文做出限制、隐藏、禁言或驳回，并留下理由与审计。"><AdminModerationView/></PrivateShell>;}
