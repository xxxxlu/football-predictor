import { AuthError, F1ResultEntryError, type F1ClassificationEntry, type F1ResultReceipt } from "@pulse/domain";
import { f1ClassificationEntrySchema } from "@pulse/contracts";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../auth/_lib/handlers";
import { assertSameOrigin } from "./request-origin";

const enterSchema = z.object({ classification: z.array(f1ClassificationEntrySchema).min(1).max(40) }).strict();
const confirmSchema = z.object({ version: z.number().int().min(1) }).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

interface Identity {
  authorizeSuperAdminAction(input: { sessionToken: string; proofToken: string }): Promise<{ id: string }>;
}
interface ResultEntry {
  enterResult(command: { sessionId: string; classification: F1ClassificationEntry[]; enteredBy: string }): Promise<F1ResultReceipt>;
  confirmResult(command: { sessionId: string; version: number; confirmedBy: string }): Promise<F1ResultReceipt>;
  cancelSession(command: { sessionId: string; cancelledBy: string; reason: string }): Promise<F1ResultReceipt>;
}

/** Super-admin F1 result administration. Entry and confirmation are separate steps;
 *  settlement is triggered asynchronously by the worker from the confirmed version. */
export function createF1AdminHandlers(identity: Identity, results: ResultEntry) {
  const superAdmin = async (request: Request) => {
    const sessionToken = readSessionToken(request);
    if (!sessionToken) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    const proofToken = readReauthProof(request);
    if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm the super-admin password again before this operation.");
    const actor = await identity.authorizeSuperAdminAction({ sessionToken, proofToken });
    return actor.id;
  };
  return {
    enterResult: (request: Request, sessionId: string) => execute(async () => {
      assertSameOrigin(request);
      const actorId = await superAdmin(request);
      const input = enterSchema.parse(await request.json());
      const receipt = await results.enterResult({ sessionId, classification: input.classification, enteredBy: actorId });
      return json({ data: receipt }, 201);
    }),
    confirmResult: (request: Request, sessionId: string) => execute(async () => {
      assertSameOrigin(request);
      const actorId = await superAdmin(request);
      const input = confirmSchema.parse(await request.json());
      const receipt = await results.confirmResult({ sessionId, version: input.version, confirmedBy: actorId });
      return json({ data: receipt });
    }),
    cancelSession: (request: Request, sessionId: string) => execute(async () => {
      assertSameOrigin(request);
      const actorId = await superAdmin(request);
      const input = cancelSchema.parse(await request.json());
      const receipt = await results.cancelSession({ sessionId, cancelledBy: actorId, reason: input.reason });
      return json({ data: receipt });
    }),
  };
}

const ERROR_STATUS: Record<F1ResultEntryError["code"], number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_CANCELLED: 409,
  SESSION_NOT_STARTED: 409,
  VERSION_CONFLICT: 409,
  INVALID_CLASSIFICATION: 422,
  UNKNOWN_DRIVER: 422,
};

async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status);
    if (error instanceof F1ResultEntryError) return failure(error.code, ERROR_STATUS[error.code]);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    return failure("INTERNAL_ERROR", 500);
  }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function failure(code: string, status: number) {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Log in to continue.",
    REAUTH_REQUIRED: "Confirm the super-admin password again before this operation.",
    FORBIDDEN: "You do not have permission for this operation.",
    SESSION_NOT_FOUND: "The requested F1 session was not found.",
    SESSION_CANCELLED: "The session has been cancelled.",
    SESSION_NOT_STARTED: "Results can only be entered after the session starts.",
    VERSION_CONFLICT: "Only the latest entered result version can be confirmed.",
    INVALID_CLASSIFICATION: "The classification is not a valid official result.",
    UNKNOWN_DRIVER: "The classification references a driver outside the entry list.",
    INVALID_REQUEST: "Check the submitted fields and try again.",
  };
  return Response.json(
    { error: { code, message: messages[code] ?? "The request could not be completed." } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
