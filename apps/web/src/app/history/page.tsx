import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { TicketHistoryView } from "@/features/operations/ticket-history-view";
export const metadata: Metadata = { title: "判断历史" };
export default function HistoryPage() { return <PrivateShell title="判断历史" description="查看已提交判断及其封盘、结算和公开状态。"><TicketHistoryView/></PrivateShell>; }
