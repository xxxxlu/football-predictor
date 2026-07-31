import type { Metadata } from "next";
import { ClubLobbyView } from "@/features/club/club-lobby-view";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "PULSE CLUB 大厅" };
export default function ClubLobbyPage() {
  return <PrivateShell title="PULSE CLUB 大厅" description="认识主动展示在场的成员、查看好友动态、发现公开房间，并在唯一的公共频道聊球。大厅不持有任何积分、预测或账本。">
    <ClubLobbyView />
  </PrivateShell>;
}
