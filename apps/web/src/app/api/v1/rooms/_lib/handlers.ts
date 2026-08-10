import { AuthError, RoomError } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

const createSchema = z.object({ name: z.string(), visibility: z.enum(["PUBLIC", "PRIVATE"]), tier: z.enum(["STANDARD", "ADVANCED"]).default("STANDARD"), sport: z.enum(["FOOTBALL", "FORMULA_1"]).default("FOOTBALL"), rulesAccepted: z.literal(true) });
const joinSchema = z.object({ rulesAccepted: z.literal(true) });
const settingsSchema = z.object({ postMatchTicketVisible: z.boolean() }).strict();

interface IdentityLookup { authenticate(token: string): Promise<{ id: string } | null> }
interface RoomsApplication {
  create(input: { userId: string; name: string; visibility: "PUBLIC" | "PRIVATE"; tier: "STANDARD" | "ADVANCED"; sport: "FOOTBALL" | "FORMULA_1"; rulesAccepted: boolean }): Promise<unknown>;
  listRooms(userId: string): Promise<unknown>;
  getRoom(roomId: string, userId: string): Promise<unknown>;
  getBalance(roomId: string, userId: string): Promise<unknown>;
  getMembers(roomId: string, userId: string): Promise<unknown>;
  resetInvite(roomId: string, userId: string): Promise<unknown>;
  previewInvite(inviteToken: string): Promise<unknown>;
  join(input: { userId: string; inviteToken: string; rulesAccepted: boolean }): Promise<unknown>;
  listPublic(userId: string, options?: { cursor?: string }): Promise<unknown>;
  joinPublic(input: { roomId: string; userId: string; rulesAccepted: boolean }): Promise<unknown>;
  updatePostMatchTicketVisibility(roomId: string, userId: string, visible: boolean): Promise<unknown>;
}

export function createRoomHandlers(identity: IdentityLookup, rooms: RoomsApplication) {
  const userId = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  return {
    create: (request: Request) => execute(async () => {
      assertSameOrigin(request); const accountId = await userId(request); const input = createSchema.parse(await request.json());
      return json({ data: await rooms.create({ userId: accountId, name: input.name, visibility: input.visibility, tier: input.tier, sport: input.sport, rulesAccepted: input.rulesAccepted }) }, 201);
    }),
    list: (request: Request) => execute(async () => json({ data: await rooms.listRooms(await userId(request)) })),
    detail: (request: Request, roomId: string) => execute(async () => json({ data: await rooms.getRoom(roomId, await userId(request)) })),
    balance: (request: Request, roomId: string) => execute(async () => json({ data: await rooms.getBalance(roomId, await userId(request)) })),
    members: (request: Request, roomId: string) => execute(async () => json({ data: await rooms.getMembers(roomId, await userId(request)) })),
    resetInvite: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); return json({ data: await rooms.resetInvite(roomId, await userId(request)) });
    }),
    previewInvite: (_request: Request, token: string) => execute(async () => json({ data: await rooms.previewInvite(token) })),
    join: (request: Request, token: string) => execute(async () => {
      assertSameOrigin(request); const accountId = await userId(request); const input = joinSchema.parse(await request.json());
      return json({ data: await rooms.join({ userId: accountId, inviteToken: token, rulesAccepted: input.rulesAccepted }) });
    }),
    listPublic: (request: Request) => execute(async () => {
      const accountId = await userId(request);
      // Absent means page one; present but empty is a malformed cursor, and the
      // service refuses it rather than silently restarting the caller at page one.
      const cursor = new URL(request.url).searchParams.get("cursor");
      return json({ data: await rooms.listPublic(accountId, cursor === null ? {} : { cursor }) });
    }),
    joinPublic: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const accountId = await userId(request); const input = joinSchema.parse(await request.json());
      return json({ data: await rooms.joinPublic({ roomId, userId: accountId, rulesAccepted: input.rulesAccepted }) });
    }),
    updateSettings: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const accountId = await userId(request); const input = settingsSchema.parse(await request.json());
      return json({ data: await rooms.updatePostMatchTicketVisibility(roomId, accountId, input.postMatchTicketVisible) });
    }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError || error instanceof RoomError) return json({ error: { code: error.code, message: error.action ?? "The requested room was not found." } }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "INVALID_REQUEST", message: "Check the submitted fields and try again." } }, 422);
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
  }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
