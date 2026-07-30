import { AuthError, parseUserSecurityQuery, type Capability, type UserSecurityQuery } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

/**
 * User security and lifecycle console (FR81, FR82).
 *
 * Reads are gated on USER_SECURITY_READ, writes on USER_SECURITY_WRITE plus a
 * fresh re-auth proof and a justification (NFR18). The console repository
 * re-checks the same capability, so no route is a single point of failure.
 */
const statusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]), reason: z.string().trim().min(5).max(500) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const uuidSchema = z.string().uuid();

interface AdminIdentity {
  requireCapability(sessionToken: string, capability: Capability): Promise<{ id: string }>;
  authorizeCapabilityAction(input: { sessionToken: string; proofToken: string; capability: Capability }): Promise<{ id: string }>;
  getAudienceStats(sessionToken: string): Promise<unknown>;
  setAccountStatus(input: { actorSessionToken: string; proofToken: string; targetUserId: string; status: "ACTIVE" | "DISABLED"; reason: string }): Promise<unknown>;
}

interface UserSecurityConsole {
  listUsers(actorUserId: string, query: UserSecurityQuery): Promise<unknown>;
  getUser(actorUserId: string, targetUserId: string): Promise<unknown>;
  revokeSessions(actorUserId: string, targetUserId: string, reason: string): Promise<unknown>;
  fileAnonymizationRequest(actorUserId: string, targetUserId: string, reason: string): Promise<unknown>;
  completeAnonymizationRequest(actorUserId: string, targetUserId: string, requestId: string, reason: string): Promise<unknown>;
  listAnonymizationRequests(actorUserId: string): Promise<unknown>;
}

export function createAdminIdentityHandlers(identity: AdminIdentity, console_: UserSecurityConsole) {
  const session = (request: Request) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return token;
  };
  const reader = async (request: Request, capability: Capability) => (await identity.requireCapability(session(request), capability)).id;
  const writer = async (request: Request, capability: Capability) => {
    assertSameOrigin(request);
    const proofToken = readReauthProof(request);
    if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    return (await identity.authorizeCapabilityAction({ sessionToken: session(request), proofToken, capability })).id;
  };
  const target = (userId: string) => {
    const parsed = uuidSchema.safeParse(userId);
    if (!parsed.success) throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only normal user accounts can be changed here.");
    return parsed.data;
  };

  return {
    list: (request: Request) => execute(async () => {
      // Filters are validated in the domain: an unknown value is refused rather
      // than dropped, so a narrowed read can never silently widen.
      const url = new URL(request.url);
      const query = parseUserSecurityQuery({
        search: url.searchParams.get("search"), status: url.searchParams.get("status"),
        activity: url.searchParams.get("activity"), restriction: url.searchParams.get("restriction"),
        minRooms: url.searchParams.get("minRooms"), limit: url.searchParams.get("limit"),
      });
      const actorId = await reader(request, "USER_SECURITY_READ");
      return json({ data: { actorId, query, users: await console_.listUsers(actorId, query) } });
    }),
    detail: (request: Request, userId: string) => execute(async () => {
      const actorId = await reader(request, "USER_SECURITY_READ");
      return json({ data: await console_.getUser(actorId, target(userId)) });
    }),
    audience: (request: Request) => execute(async () => json({ data: await identity.getAudienceStats(session(request)) })),
    setStatus: (request: Request, userId: string) => execute(async () => {
      assertSameOrigin(request);
      const proofToken = readReauthProof(request);
      if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
      const input = statusSchema.parse(await request.json());
      return json({ data: await identity.setAccountStatus({ actorSessionToken: session(request), proofToken, targetUserId: target(userId), status: input.status, reason: input.reason }) });
    }),
    revokeSessions: (request: Request, userId: string) => execute(async () => {
      const input = reasonSchema.parse(await request.json());
      const actorId = await writer(request, "USER_SECURITY_WRITE");
      return json({ data: await console_.revokeSessions(actorId, target(userId), input.reason) });
    }),
    listAnonymizationRequests: (request: Request) => execute(async () => {
      const actorId = await reader(request, "USER_SECURITY_READ");
      return json({ data: { requests: await console_.listAnonymizationRequests(actorId) } });
    }),
    fileAnonymizationRequest: (request: Request, userId: string) => execute(async () => {
      const input = reasonSchema.parse(await request.json());
      const actorId = await writer(request, "USER_SECURITY_WRITE");
      return json({ data: await console_.fileAnonymizationRequest(actorId, target(userId), input.reason) }, 201);
    }),
    completeAnonymizationRequest: (request: Request, userId: string, requestId: string) => execute(async () => {
      const input = reasonSchema.parse(await request.json());
      const parsedRequest = uuidSchema.safeParse(requestId);
      if (!parsedRequest.success) throw new AuthError("ANONYMIZATION_REQUEST_NOT_OPEN", 409, "That anonymization request is not open.");
      const actorId = await writer(request, "USER_SECURITY_WRITE");
      return json({ data: await console_.completeAnonymizationRequest(actorId, target(userId), parsedRequest.data, input.reason) });
    }),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  FORBIDDEN: "You do not have permission for this operation.",
  REAUTH_REQUIRED: "Confirm your password again before this operation.",
  REASON_REQUIRED: "Give a reason between 5 and 500 characters.",
  TARGET_NOT_MANAGEABLE: "Only normal user accounts can be changed here.",
  TARGET_NOT_ANONYMIZABLE: "Only an active normal account can have its public identity removed.",
  USER_NOT_FOUND: "The requested account was not found.",
  ANONYMIZATION_REQUEST_EXISTS: "This account already has an open anonymization request.",
  ANONYMIZATION_REQUEST_NOT_OPEN: "That anonymization request is not open.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
};

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStore }); }
async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status, error.action);
    if (error instanceof OperationError) return failure(error.code, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    return failure("INTERNAL_ERROR", 500);
  }
}
function failure(code: string, status: number, action?: string) {
  return Response.json({ error: { code, message: action ?? MESSAGES[code] ?? "The request could not be completed." } }, { status, headers: noStore });
}
