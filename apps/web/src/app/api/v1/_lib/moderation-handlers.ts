import { OperationError, type RoomModerationAction } from "@football-predictor/db";
import { AuthError } from "@football-predictor/domain";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../auth/_lib/handlers";
import { assertSameOrigin } from "./request-origin";

const reportSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const moderationSchema = z.object({ action: z.enum(["RESTRICT", "CLOSE", "RESTORE"]), reason: z.string().trim().min(5).max(500) }).strict();
const visibilitySchema = z.object({ preMatchStakeVisible: z.boolean() }).strict();
const deleteSchema = z.object({ confirmation: z.literal("DELETE") }).strict();

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
  authorizeSuperAdminAction(input: { sessionToken: string; proofToken: string }): Promise<{ id: string }>;
}
interface Moderation {
  reportRoom(roomId: string, userId: string, reason: string): Promise<unknown>;
  listReports(userId: string): Promise<unknown>;
  listAudit(userId: string): Promise<unknown>;
  listRooms(userId: string): Promise<unknown>;
  updatePreMatchStakeVisibility(userId: string, roomId: string, visible: boolean): Promise<unknown>;
  moderateRoom(userId: string, roomId: string, action: RoomModerationAction, reason: string): Promise<unknown>;
  deleteAccount(userId: string): Promise<unknown>;
}

export function createModerationHandlers(identity: Identity, moderation: Moderation, options: { secureCookie: boolean }) {
  const user = async (request: Request) => {
    const token = readSessionToken(request); const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  return {
    reportRoom: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const id = await user(request); const input = reportSchema.parse(await request.json());
      return json({ data: await moderation.reportRoom(roomId, id, input.reason) }, 201);
    }),
    listReports: (request: Request) => execute(async () => json({ data: await moderation.listReports(await user(request)) })),
    listAudit: (request: Request) => execute(async () => json({ data: await moderation.listAudit(await user(request)) })),
    listRooms: (request: Request) => execute(async () => json({ data: await moderation.listRooms(await user(request)) })),
    moderateRoom: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const input = moderationSchema.parse(await request.json());
      const sessionToken = readSessionToken(request); if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const proofToken = readReauthProof(request); if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm the super-admin password again before this operation.");
      const actor = await identity.authorizeSuperAdminAction({ sessionToken, proofToken });
      return json({ data: await moderation.moderateRoom(actor.id, roomId, input.action, input.reason) });
    }),
    updatePreMatchVisibility: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const input = visibilitySchema.parse(await request.json());
      const sessionToken = readSessionToken(request); if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const proofToken = readReauthProof(request); if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm the super-admin password again before this operation.");
      const actor = await identity.authorizeSuperAdminAction({ sessionToken, proofToken });
      return json({ data: await moderation.updatePreMatchStakeVisibility(actor.id, roomId, input.preMatchStakeVisible) });
    }),
    deleteAccount: (request: Request) => execute(async () => {
      assertSameOrigin(request); const id = await user(request); deleteSchema.parse(await request.json());
      const result = await moderation.deleteAccount(id); const response = json({ data: result });
      response.headers.append("set-cookie", `fp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${options.secureCookie ? "; Secure" : ""}`);
      return response;
    }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError || error instanceof OperationError) return failure(error.code, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    return failure("INTERNAL_ERROR", 500);
  }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function failure(code: string, status: number) {
  const message = code === "FORBIDDEN" ? "You do not have permission for this operation." : code === "ROOM_NOT_FOUND" ? "The requested room was not found." : code === "UNAUTHENTICATED" ? "Log in to continue." : code === "INVALID_REQUEST" ? "Check the submitted fields and try again." : "The request could not be completed.";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
