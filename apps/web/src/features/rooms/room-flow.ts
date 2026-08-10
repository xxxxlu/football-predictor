export type RoomRole = "member" | "room_owner";
export type RoomVisibility = "PUBLIC" | "PRIVATE";
export type RoomTier = "STANDARD" | "ADVANCED";
export type RoomSport = "FOOTBALL" | "FORMULA_1";

export const ROOM_SPORT_LABELS: Record<RoomSport, string> = { FOOTBALL: "足球", FORMULA_1: "F1 赛车" };

export type RoomSummaryRecord = {
  id: string;
  name: string;
  status?: "ACTIVE" | "RESTRICTED" | "CLOSED";
  visibility: RoomVisibility;
  tier?: RoomTier;
  sport?: RoomSport;
  role: RoomRole;
  memberCount?: number;
  preMatchStakeVisible?: boolean;
  postMatchTicketVisible?: boolean;
};

export type PublicRoomSummaryRecord = {
  id: string;
  name: string;
  ownerName: string;
  sport?: RoomSport;
  memberCount: number;
  joined: boolean;
};

export type RoomMemberRecord = {
  userId: string;
  username: string;
  role: RoomRole;
  /** Story 12.6: null when the member has no avatar, or the viewer blocked them. */
  avatarUrl?: string | null;
  avatarVersion?: number | null;
};

export type RoomBalanceRecord = {
  availablePoints: string;
  frozenPoints: string;
  correctionDebt?: string;
};

export function createRoomRequest(name: string, visibility: RoomVisibility, tier: RoomTier = "STANDARD", sport: RoomSport = "FOOTBALL") {
  return {
    url: "/api/v1/rooms",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin" as const,
      body: JSON.stringify({ name: name.trim(), visibility, tier, sport, rulesAccepted: true }),
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
    tier: input.room.tier ?? "STANDARD",
    sport: input.room.sport ?? "FOOTBALL",
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
