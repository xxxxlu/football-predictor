import type { Metadata } from "next";
import { InviteView } from "@/features/rooms/invite-view";

export const metadata: Metadata = { title: "加入私人房间", robots: { index: false, follow: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteView token={token}/>;
}
