export type RoomRole = "member" | "room_owner";
export type RoomVisibility = "PUBLIC" | "PRIVATE";

export type RoomSummaryRecord = {
  id: string;
  name: string;
  status?: "ACTIVE" | "RESTRICTED" | "CLOSED";
  visibility: RoomVisibility;
  role: RoomRole;
  memberCount?: number;
  preMatchStakeVisible?: boolean;
  postMatchTicketVisible?: boolean;
};

export type PublicRoomSummaryRecord = {
  id: string;
  name: string;
  ownerName: string;
  memberCount: number;
  joined: boolean;
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

export function createRoomRequest(name: string, visibility: RoomVisibility) {
  return {
    url: "/api/v1/rooms",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ name: name.trim(), visibility, rulesAccepted: true }),
    },
  };
}

export function publicRoomJoinRequest(roomId: string) {
  return {
    url: `/api/v1/rooms/${encodeURIComponent(roomId)}/join`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ rulesAccepted: true }),
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
    visibility: input.room.visibility,
    memberCount: input.room.memberCount ?? input.members.length,
    isOwner: input.room.role === "room_owner",
    preMatchStakeVisible: input.room.preMatchStakeVisible === true,
    postMatchTicketVisible: input.room.postMatchTicketVisible !== false,
    balance: input.balance,
    members: input.members.map((member) => ({
      ...member,
      displayName: member.username,
      roleLabel: member.role === "room_owner" ? "房主" : "成员",
    })),
  };
}
