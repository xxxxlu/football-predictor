export type RoomRole = "member" | "room_owner";

export type RoomSummaryRecord = {
  id: string;
  name: string;
  status?: "ACTIVE" | "RESTRICTED" | "CLOSED";
  role: RoomRole;
  memberCount?: number;
};

export type RoomMemberRecord = {
  userId: string;
  username: string;
  role: RoomRole;
};

export type RoomBalanceRecord = {
  availablePoints: string;
  frozenPoints: string;
  correctionDebt?: string;
};

export function createRoomRequest(name: string) {
  return {
    url: "/api/v1/rooms",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ name: name.trim(), rulesAccepted: true }),
    },
  };
}

export function buildInvitePath(token: string) {
  return `/invite/${encodeURIComponent(token)}`;
}

export function inviteJoinRequest(token: string) {
  return {
    url: `/api/v1/rooms/invites/${encodeURIComponent(token)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ rulesAccepted: true }),
    },
  };
}

export function normalizeRoomDetail(input: {
  room: RoomSummaryRecord;
  balance: RoomBalanceRecord;
  members: RoomMemberRecord[];
}) {
  return {
    id: input.room.id,
    name: input.room.name,
    status: input.room.status ?? "ACTIVE",
    memberCount: input.room.memberCount ?? input.members.length,
    isOwner: input.room.role === "room_owner",
    balance: input.balance,
    members: input.members.map((member) => ({
      ...member,
      displayName: member.username,
      roleLabel: member.role === "room_owner" ? "房主" : "成员",
    })),
  };
}
