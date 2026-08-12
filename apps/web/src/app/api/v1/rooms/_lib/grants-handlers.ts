import { AuthError, RoomError, type GrantDecisionAction } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

/**
 * Room grant requests (Story 8.1, FR43-FR45).
 *
 * Every route resolves the caller's membership — and, on the decision surface,
 * ownership — inside the repository, in SQL: a non-member or non-owner gets
 * the same 404 a missing room or request would produce. Amount and note rules
 * live in the domain (normalizeGrantAmount / normalizeGrantNote); the schema
 * only refuses shapes that could never be valid.
 */

// The domain counts 200 code points; the schema cap merely refuses megabyte
// bodies before they are trimmed and code-point-counted.
const requestSchema = z.object({ note: z.string().max(1000).optional() }).strict();
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), amount: z.number(), note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("DENY"), note: z.string().max(1000).optional() }).strict(),
]);
const uuidSchema = z.string().uuid();

interface GrantIdentity { authenticate(token: string): Promise<{ id: string } | null> }
interface RoomGrants {
  list(roomId: string, userId: string): Promise<unknown>;
  request(input: { roomId: string; userId: string; note?: string | null }): Promise<unknown>;
  decide(input: { roomId: string; grantId: string; ownerId: string; action: GrantDecisionAction; amount?: number; note?: string | null }): Promise<unknown>;
}

export function createRoomGrantHandlers(identity: GrantIdentity, grants: RoomGrants) {
  const userId = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  // Malformed ids answer the same shape as unknown ones — reaching the
  // database with a non-uuid would turn "not found" into a 500.
  const room = (roomId: string) => {
    const parsed = uuidSchema.safeParse(roomId);
    if (!parsed.success) throw new RoomError("ROOM_NOT_FOUND", 404);
    return parsed.data;
  };
  const grant = (grantId: string) => {
    const parsed = uuidSchema.safeParse(grantId);
    if (!parsed.success) throw new RoomError("GRANT_NOT_FOUND", 404);
    return parsed.data;
  };

  return {
    list: (request: Request, roomId: string) => execute(async () => {
      const accountId = await userId(request);
      return json({ data: await grants.list(room(roomId), accountId) });
    }),
    request: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = requestSchema.parse(await request.json());
      return json({ data: await grants.request({ roomId: room(roomId), userId: accountId, note: input.note ?? null }) }, 201);
    }),
    decide: (request: Request, roomId: string, grantId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = decisionSchema.parse(await request.json());
      return json({
        data: await grants.decide({
          roomId: room(roomId), grantId: grant(grantId), ownerId: accountId, action: input.action,
          ...(input.action === "APPROVE" ? { amount: input.amount } : {}), note: input.note ?? null,
        }),
      });
    }),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "The requested room was not found.",
  GRANT_NOT_FOUND: "That grant request was not found.",
  GRANT_REQUEST_EXISTS: "Your previous request is still waiting for the owner.",
  GRANT_ALREADY_DECIDED: "This request was already decided. Reload to see the outcome.",
  GRANT_AMOUNT_INVALID: "Use a whole amount between 1 and 20,000 points.",
  GRANT_NOTE_TOO_LONG: "Keep the note within 200 characters.",
  ROOM_NOT_ACTIVE: "Grants are only available while the room is active.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
};

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStore }); }
async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError || error instanceof RoomError) return failure(error.code, error.status, error.action);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    console.error("room grant handler failed", error);
    return failure("INTERNAL_ERROR", 500);
  }
}
function failure(code: string, status: number, action?: string) {
  return Response.json({ error: { code, message: action ?? MESSAGES[code] ?? "The request could not be completed." } }, { status, headers: noStore });
}
