import { OperationError, type RoomModerationAction } from "@pulse/db";
import { AuthError, type Capability } from "@pulse/domain";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../auth/_lib/handlers";
import { governanceReason } from "./reason";
import { assertSameOrigin } from "./request-origin";

// `room.reports.reason` is CHECKed at 10-500, the moderation note at 5-500.
const reportSchema = z.object({ reason: governanceReason(10) }).strict();
const moderationSchema = z.object({ action: z.enum(["RESTRICT", "CLOSE", "RESTORE"]), reason: governanceReason() }).strict();
const visibilitySchema = z.object({ preMatchStakeVisible: z.boolean() }).strict();
const deleteSchema = z.object({ confirmation: z.literal("DELETE") }).strict();

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
  requireCapability(sessionToken: string, capability: Capability): Promise<{ id: string }>;
  authorizeCapabilityAction(input: { sessionToken: string; proofToken: string; capability: Capability }): Promise<{ id: string }>;
}
interface Moderation {
  reportRoom(roomId: string, userId: string, reason: string): Promise<unknown>;
  listReports(userId: string): Promise<unknown>;
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
  // Governance reads are authorized at the route boundary as well as inside the
  // repository, so no route depends on a single check — or on the UI hiding it.
  const governanceReader = async (request: Request, capability: Capability) => {
    const sessionToken = readSessionToken(request); if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return (await identity.requireCapability(sessionToken, capability)).id;
  };
  // Governance writes need the duty plus a fresh re-auth proof (NFR18). The
  // repository re-checks the same capability independently.
  const governanceActor = async (request: Request, capability: Capability) => {
    const sessionToken = readSessionToken(request); if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    const proofToken = readReauthProof(request); if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    return (await identity.authorizeCapabilityAction({ sessionToken, proofToken, capability })).id;
  };
  return {
    reportRoom: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const id = await user(request); const input = reportSchema.parse(await request.json());
      return json({ data: await moderation.reportRoom(roomId, id, input.reason) }, 201);
    }),
    // Room filings, not the shared queue: this read is not narrowed by report kind
    // and hands back room identity, so it needs the room-side duty. ROOM_REPORT_READ
    // is the governance inbox's shared key (Story 11.3) and a community moderator
    // holds it — gating this route on it would let them enumerate every room.
    listReports: (request: Request) => execute(async () => json({ data: await moderation.listReports(await governanceReader(request, "ROOM_GOVERNANCE_READ")) })),
    listRooms: (request: Request) => execute(async () => json({ data: await moderation.listRooms(await governanceReader(request, "ROOM_GOVERNANCE_READ")) })),
    moderateRoom: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const input = moderationSchema.parse(await request.json());
      const actorId = await governanceActor(request, "ROOM_GOVERNANCE_WRITE");
      return json({ data: await moderation.moderateRoom(actorId, roomId, input.action, input.reason) });
    }),
    updatePreMatchVisibility: (request: Request, roomId: string) => execute(async () => {
      assertSameOrigin(request); const input = visibilitySchema.parse(await request.json());
      const actorId = await governanceActor(request, "ROOM_GOVERNANCE_WRITE");
      return json({ data: await moderation.updatePreMatchStakeVisibility(actorId, roomId, input.preMatchStakeVisible) });
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
