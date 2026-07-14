import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { TicketHistoryView } from "@/features/operations/ticket-history-view";
export const metadata: Metadata = { title: "长期档案" };
export default function HistoryPage() { return <PrivateShell title="长期档案" description="按赛事和赛季查看跨房间累计的已结算判断，并追溯结算版本与账本审计。"><TicketHistoryView/></PrivateShell>; }
