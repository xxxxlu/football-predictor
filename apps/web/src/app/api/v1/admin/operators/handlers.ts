import { AuthError, GRANTABLE_OPERATOR_ROLES } from "@pulse/domain";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

/**
 * Operator duty administration (FR80). Only `OPERATOR_ROLE_MANAGE` reaches these
 * routes and the service re-checks it per request — the back-office navigation
 * hiding the entry is a convenience, never the boundary.
 */
const roleSchema = z.enum(GRANTABLE_OPERATOR_ROLES);
const targetSchema = z.string().uuid();

interface OperatorIdentity {
  listOperatorRoster(sessionToken: string): Promise<unknown>;
  setOperatorRole(input: { actorSessionToken: string; proofToken: string; targetUserId: string; role: string; granted: boolean }): Promise<unknown>;
}

export function createOperatorRoleHandlers(identity: OperatorIdentity) {
  const session = (request: Request) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return token;
  };
  const change = (granted: boolean) => (request: Request, targetUserId: string, role: string) => execute(async () => {
    assertSameOrigin(request);
    const proofToken = readReauthProof(request);
    if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    // Path segments are untrusted input: reject anything outside the grantable
    // set before the service is asked to do anything.
    const parsedRole = roleSchema.safeParse(role);
    if (!parsedRole.success) throw new AuthError("ROLE_NOT_GRANTABLE", 422, "Only the operations-admin and community-moderator duties can be granted.");
    const parsedTarget = targetSchema.safeParse(targetUserId);
    if (!parsedTarget.success) throw new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only normal user accounts can be changed here.");
    const actorSessionToken = session(request);
    return Response.json({ data: await identity.setOperatorRole({ actorSessionToken, proofToken, targetUserId: parsedTarget.data, role: parsedRole.data, granted }) }, { headers: noStore });
  });
  return {
    list: (request: Request) => execute(async () => Response.json({ data: await identity.listOperatorRoster(session(request)) }, { headers: noStore })),
    grant: change(true),
    revoke: change(false),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  FORBIDDEN: "You do not have permission for this operation.",
  REAUTH_REQUIRED: "Confirm your password again before this operation.",
  SELF_ROLE_CHANGE_FORBIDDEN: "Ask the other super administrator to change your own duties.",
  ROLE_NOT_GRANTABLE: "Only the operations-admin and community-moderator duties can be granted.",
  TARGET_NOT_MANAGEABLE: "Only active normal accounts can hold an operator duty.",
};

async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status, error.action);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    return failure("INTERNAL_ERROR", 500);
  }
}
function failure(code: string, status: number, action?: string) {
  return Response.json({ error: { code, message: action ?? MESSAGES[code] ?? "The request could not be completed." } }, { status, headers: noStore });
}
