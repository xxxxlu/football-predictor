import type { Metadata } from "next";
import { FriendsView } from "@/features/friends/friends-view";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "好友" };
export default function FriendsPage() {
  return <PrivateShell title="好友" description="按 PULSE ID 添加好友，处理申请，管理屏蔽名单。在线状态只对互为好友且双方开启展示的成员可见。">
    <FriendsView />
  </PrivateShell>;
}
