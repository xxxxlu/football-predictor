import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { SubmissionStatusView } from "@/features/operations/submission-status-view";
export const metadata: Metadata = { title: "成员提交状态" };
export default async function RoomStatusPage({ params }: { params: Promise<{ roomId: string }> }) { const { roomId } = await params; return <PrivateShell title="成员提交状态" description="房主只能看到谁已提交；封盘前不能查看任何人的选择和投入。"><SubmissionStatusView roomId={roomId}/></PrivateShell>; }
