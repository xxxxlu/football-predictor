import { AuthError } from "@football-predictor/domain";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

const statusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).strict();
interface AdminIdentity {
  listManageableAccounts(sessionToken: string): Promise<unknown>;
  setAccountStatus(input: { actorSessionToken: string; proofToken: string; targetUserId: string; status: "ACTIVE" | "DISABLED" }): Promise<unknown>;
}

export function createAdminIdentityHandlers(identity: AdminIdentity) {
  const session = (request: Request) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return token;
  };
  return {
    list: (request: Request) => execute(async () => Response.json({ data: await identity.listManageableAccounts(session(request)) }, { headers: noStore })),
    setStatus: (request: Request, targetUserId: string) => execute(async () => {
      assertSameOrigin(request);
      const proofToken = readReauthProof(request);
      if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm the super-admin password again before this operation.");
      const input = statusSchema.parse(await request.json());
      return Response.json({ data: await identity.setAccountStatus({ actorSessionToken: session(request), proofToken, targetUserId, status: input.status }) }, { headers: noStore });
    }),
  };
}

const noStore = { "cache-control": "no-store" };
async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return Response.json({ error: { code: error.code, message: error.action ?? "Request could not be completed." } }, { status: error.status, headers: noStore });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: { code: "INVALID_REQUEST", message: "Check the submitted fields and try again." } }, { status: 422, headers: noStore });
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, { status: 500, headers: noStore });
  }
}
