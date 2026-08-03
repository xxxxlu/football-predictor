import { AuthError, MUTE_DURATION_HOURS, normalizeMessageBody, type MuteDurationHours } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { z } from "zod";
import { readSessionToken } from "../../auth/_lib/handlers";
import { governanceReason } from "../../_lib/reason";
import { assertSameOrigin } from "../../_lib/request-origin";

/**
 * Member-protected room public chat (Story 12.3, FR88–FR90).
 *
 * Every route resolves the caller's membership inside the repository, in SQL —
 * a non-member (and a non-owner, on the owner-only surfaces) gets the same
 * ROOM_NOT_FOUND a missing room would produce. Message reports go through the
 * governance inbox write path, which derives the evidence (subject, excerpt,
 * sent-at) from the message row itself, never from the reporter.
 */

// The hard bound is 500 code points, counted after normalization; the schema
// cap only exists to refuse megabyte bodies before they are trimmed and
// code-point-counted (500 astral code points = 1000 UTF-16 units, plus slack).
const sendSchema = z.object({ body: z.string().max(4000) }).strict();
const muteSchema = z.object({
  // Lowercased before any comparison: zod's uuid() admits uppercase, while the
  // self-mute guard compares against a lowercase session id — an uppercased
  // own id must not slip past it into the member lookup.
  memberUserId: z.string().uuid().transform((value) => value.toLowerCase()),
  muteHours: z.union(MUTE_DURATION_HOURS.map((hours) => z.literal(hours)) as [z.ZodLiteral<1>, z.ZodLiteral<24>, z.ZodLiteral<72>, z.ZodLiteral<168>]),
  reason: governanceReason(),
}).strict();
const unmuteSchema = z.object({ reason: governanceReason() }).strict();
// Same floor as the room-report form: ten code points of actual explanation.
const reportSchema = z.object({ reason: governanceReason(10) }).strict();
const uuidSchema = z.string().uuid();

interface ChatIdentity { authenticate(token: string): Promise<{ id: string } | null> }
interface RoomChat {
  listMessages(roomId: string, userId: string, options: { cursor?: string }): Promise<{ cursor: string | null } & Record<string, unknown>>;
  sendMessage(roomId: string, userId: string, body: string): Promise<unknown>;
  pinMessage(roomId: string, ownerId: string, messageId: string): Promise<unknown>;
  unpinMessage(roomId: string, ownerId: string, messageId: string): Promise<unknown>;
  muteMember(roomId: string, ownerId: string, input: { memberUserId: string; muteHours: MuteDurationHours; reason: string }): Promise<unknown>;
  unmuteMember(roomId: string, ownerId: string, muteId: string, reason: string): Promise<unknown>;
}
interface MessageReports {
  reportMessage(input: { messageId: string; roomId: string; reporterUserId: string; reason: string }): Promise<unknown>;
}

export function createRoomChatHandlers(identity: ChatIdentity, chat: RoomChat, reports: MessageReports) {
  const userId = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  // Malformed ids answer the same shape as unknown ones — reaching the database
  // with a non-uuid would turn "not found" into a 500.
  const room = (roomId: string) => {
    const parsed = uuidSchema.safeParse(roomId);
    if (!parsed.success) throw new OperationError("ROOM_NOT_FOUND", 404);
    return parsed.data;
  };
  const message = (messageId: string) => {
    const parsed = uuidSchema.safeParse(messageId);
    if (!parsed.success) throw new OperationError("MESSAGE_NOT_FOUND", 404);
    return parsed.data;
  };

  return {
    list: (request: Request, roomId: string) => execute(async () => {
      const accountId = await userId(request);
      const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
      const { cursor: nextCursor, ...data } = await chat.listMessages(room(roomId), accountId, { cursor });
      return json({ data, meta: { cursor: nextCursor } });
    }),
    send: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = sendSchema.parse(await request.json());
      const body = normalizeMessageBody(input.body);
      if (!body) throw new OperationError("MESSAGE_INVALID", 422);
      return json({ data: await chat.sendMessage(room(roomId), accountId, body) }, 201);
    }),
    pin: (request: Request, roomId: string, messageId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      return json({ data: await chat.pinMessage(room(roomId), accountId, message(messageId)) });
    }),
    unpin: (request: Request, roomId: string, messageId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      return json({ data: await chat.unpinMessage(room(roomId), accountId, message(messageId)) });
    }),
    mute: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = muteSchema.parse(await request.json());
      return json({ data: await chat.muteMember(room(roomId), accountId, input) }, 201);
    }),
    unmute: (request: Request, roomId: string, muteId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = unmuteSchema.parse(await request.json());
      // A malformed muteId is folded to the nil uuid instead of answered
      // early: the repository then runs its owner/room gate first, so a
      // non-owner probing with junk gets the same ROOM_NOT_FOUND as on every
      // other surface, and an owner gets MUTE_NOT_ACTIVE — never a bespoke
      // pre-auth shape.
      const parsed = uuidSchema.safeParse(muteId);
      const muteKey = parsed.success ? parsed.data : "00000000-0000-0000-0000-000000000000";
      return json({ data: await chat.unmuteMember(room(roomId), accountId, muteKey, input.reason) });
    }),
    report: (request: Request, roomId: string, messageId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = reportSchema.parse(await request.json());
      return json({ data: await reports.reportMessage({ messageId: message(messageId), roomId: room(roomId), reporterUserId: accountId, reason: input.reason }) }, 201);
    }),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  ROOM_NOT_FOUND: "The requested room was not found.",
  ROOM_NOT_ACTIVE: "This room is not accepting new messages.",
  MUTED: "You are muted in this room right now.",
  RATE_LIMITED: "You are sending messages too quickly. Wait a moment.",
  DUPLICATE_MESSAGE: "That is the same as your last message.",
  MESSAGE_INVALID: "Messages are 1 to 500 characters.",
  MESSAGE_NOT_FOUND: "That message was not found.",
  MESSAGE_NOT_PINNED: "No message is pinned right now.",
  MEMBER_NOT_FOUND: "That member is not in this room.",
  SELF_MUTE_FORBIDDEN: "You cannot mute yourself.",
  SELF_REPORT_FORBIDDEN: "You cannot report your own message.",
  MUTE_ALREADY_ACTIVE: "That member already has an active mute in this room.",
  MUTE_NOT_ACTIVE: "There is no active mute to lift.",
  REPORT_ALREADY_OPEN: "You already have an open report for this message.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
};

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStore }); }
async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status, error.action);
    if (error instanceof OperationError) return failure(error.code, error.status, undefined, error.details);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    console.error("room chat handler failed", error);
    return failure("INTERNAL_ERROR", 500);
  }
}
function failure(code: string, status: number, action?: string, details?: Record<string, unknown>) {
  // `details` carries caller-owned facts a refusal may legitimately disclose
  // (today: the caller's own mutedUntil on a MUTED send). Spread first so the
  // code/message contract can never be overwritten by a repository payload.
  return Response.json({ error: { ...(details ?? {}), code, message: action ?? MESSAGES[code] ?? "The request could not be completed." } }, { status, headers: noStore });
}
