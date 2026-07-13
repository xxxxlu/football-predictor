import { OperationError } from "@football-predictor/db";
import { AuthError } from "@football-predictor/domain";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/handlers";

const nicknameSchema = z.object({ nickname: z.string().trim().min(2).max(32) }).strict();
interface Identity { authenticate(token: string): Promise<{ id: string } | null> }
interface Operations {
  getProfile(userId: string): Promise<unknown>; updateNickname(userId: string, nickname: string): Promise<unknown>;
  submissionStatus(roomId: string, userId: string): Promise<unknown>; ticketHistory(roomId: string, userId: string): Promise<unknown>;
  ledger(roomId: string, userId: string): Promise<unknown>; leaderboard(roomId: string, userId: string): Promise<unknown>; adminStatus(userId: string): Promise<unknown>;
}
export function createOperationsHandlers(identity: Identity, operations: Operations) {
  const user = async (request: Request) => { const token = readSessionToken(request); const account = token ? await identity.authenticate(token) : null; if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue."); return account.id; };
  const read = (operation: (id: string) => Promise<unknown>) => (request: Request) => execute(async () => json({ data: await operation(await user(request)) }));
  const roomRead = (operation: (roomId: string, userId: string) => Promise<unknown>) => (request: Request, roomId: string) => execute(async () => json({ data: await operation(roomId, await user(request)) }));
  return {
    profileGet: read((id) => operations.getProfile(id)),
    profilePatch: (request: Request) => execute(async () => { assertSameOrigin(request); const id = await user(request); const input = nicknameSchema.parse(await request.json()); return json({ data: await operations.updateNickname(id, input.nickname) }); }),
    submissionStatus: roomRead((roomId, id) => operations.submissionStatus(roomId, id)),
    ticketHistory: roomRead((roomId, id) => operations.ticketHistory(roomId, id)),
    ledger: roomRead((roomId, id) => operations.ledger(roomId, id)),
    leaderboard: roomRead((roomId, id) => operations.leaderboard(roomId, id)),
    adminStatus: read((id) => operations.adminStatus(id)),
  };
}
async function execute(operation: () => Promise<Response>) { try { return await operation(); } catch (error) { if (error instanceof AuthError || error instanceof OperationError) return failure(error.code, error.status); if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422); return failure("INTERNAL_ERROR", 500); } }
function json(body: unknown) { return Response.json(body, { headers: { "cache-control": "no-store" } }); }
function failure(code: string, status: number) { const message = code === "FORBIDDEN" ? "You do not have permission for this operation." : code === "ROOM_NOT_FOUND" ? "The requested room was not found." : code === "UNAUTHENTICATED" ? "Log in to continue." : code === "INVALID_REQUEST" ? "Check the submitted fields and try again." : "The request could not be completed."; return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } }); }
function assertSameOrigin(request: Request) { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new AuthError("INVALID_ORIGIN", 403); }
