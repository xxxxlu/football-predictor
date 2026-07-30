import { OperationError } from "@pulse/db";
import { AuthError } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/handlers";
import { assertSameOrigin } from "./request-origin";

const nicknameSchema = z.object({ nickname: z.string().trim().min(2).max(32) }).strict();
interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
  requireCapability(sessionToken: string, capability: "OPERATIONS_HEALTH_READ"): Promise<{ id: string }>;
}
interface Operations {
  getProfile(userId: string): Promise<unknown>; updateNickname(userId: string, nickname: string): Promise<unknown>;
  accountHistory(userId: string): Promise<unknown>;
  submissionStatus(roomId: string, userId: string): Promise<unknown>; ticketHistory(roomId: string, userId: string): Promise<unknown>;
  myTickets(roomId: string, userId: string, fixtureId?: string): Promise<unknown>;
  ledger(roomId: string, userId: string): Promise<unknown>; leaderboard(roomId: string, userId: string): Promise<unknown>; adminStatus(userId: string): Promise<unknown>;
}
export function createOperationsHandlers(identity: Identity, operations: Operations) {
  const user = async (request: Request) => { const token = readSessionToken(request); const account = token ? await identity.authenticate(token) : null; if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue."); return account.id; };
  const read = (operation: (id: string) => Promise<unknown>) => (request: Request) => execute(async () => json({ data: await operation(await user(request)) }));
  const roomRead = (operation: (roomId: string, userId: string) => Promise<unknown>) => (request: Request, roomId: string) => execute(async () => json({ data: await operation(roomId, await user(request)) }));
  return {
    profileGet: read((id) => operations.getProfile(id)),
    accountHistory: read((id) => operations.accountHistory(id)),
    profilePatch: (request: Request) => execute(async () => { assertSameOrigin(request); const id = await user(request); const input = nicknameSchema.parse(await request.json()); return json({ data: await operations.updateNickname(id, input.nickname) }); }),
    submissionStatus: roomRead((roomId, id) => operations.submissionStatus(roomId, id)),
    ticketHistory: roomRead((roomId, id) => operations.ticketHistory(roomId, id)),
    // No fixtureId = every unsettled ticket in the room (the football match list holds
    // many slips at once and must not fan out one request per card).
    myTickets: (request: Request, roomId: string) => execute(async () => {
      const id = await user(request);
      const fixtureId = new URL(request.url).searchParams.get("fixtureId")?.trim() || undefined;
      if (fixtureId !== undefined && fixtureId.length > 128) return failure("INVALID_REQUEST", 422);
      return json({ data: await operations.myTickets(roomId, id, fixtureId) });
    }),
    ledger: roomRead((roomId, id) => operations.ledger(roomId, id)),
    leaderboard: roomRead((roomId, id) => operations.leaderboard(roomId, id)),
    // Authorized at the route boundary and again inside the repository: the
    // operational-health view is an operator surface, not a member surface.
    adminStatus: (request: Request) => execute(async () => {
      const token = readSessionToken(request);
      if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const actor = await identity.requireCapability(token, "OPERATIONS_HEALTH_READ");
      return json({ data: await operations.adminStatus(actor.id) });
    }),
  };
}
async function execute(operation: () => Promise<Response>) { try { return await operation(); } catch (error) { if (error instanceof AuthError || error instanceof OperationError) return failure(error.code, error.status); if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422); console.error("[operations] unexpected failure", error); return failure("INTERNAL_ERROR", 500); } }
function json(body: unknown) { return Response.json(body, { headers: { "cache-control": "no-store" } }); }
function failure(code: string, status: number) { const message = code === "FORBIDDEN" ? "You do not have permission for this operation." : code === "ROOM_NOT_FOUND" ? "The requested room was not found." : code === "UNAUTHENTICATED" ? "Log in to continue." : code === "INVALID_REQUEST" ? "Check the submitted fields and try again." : "The request could not be completed."; return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } }); }
