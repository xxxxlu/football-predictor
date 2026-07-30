import { AuthError, OVERVIEW_CAPABILITIES, parseAuditQuery, type AuditQuery, type Capability } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../../auth/_lib/handlers";
import { assertSameOrigin } from "../../_lib/request-origin";

/**
 * Unified operations overview and permission audit (FR58, FR60, FR81, FR90).
 *
 * The aggregate route admits any account holding one operational read duty and
 * lets the repository assemble only that account's cards — the route cannot know
 * which sections apply before it knows the duties, and the repository re-checks
 * every one of them (AC2).
 *
 * The audit read needs AUDIT_READ, which only a super-admin holds. The task retry
 * needs OPERATIONS_TASK_RETRY *and* a fresh identity confirmation with a written
 * reason (NFR18): re-queueing production work is an operational write, even
 * though it can only ever repeat work that already exists.
 */

const reasonField = z.string().trim().min(5).max(500);
const retrySchema = z.object({ reason: reasonField }).strict();
const uuidSchema = z.string().uuid();

interface OverviewIdentity {
  requireCapability(sessionToken: string, capability: Capability): Promise<{ id: string }>;
  authorizeCapabilityAction(input: { sessionToken: string; proofToken: string; capability: Capability }): Promise<{ id: string }>;
}

interface Overview {
  overview(actorUserId: string): Promise<unknown>;
  listFailedJobs(actorUserId: string): Promise<unknown>;
  listAudit(actorUserId: string, query: AuditQuery): Promise<unknown>;
  retryJob(actorUserId: string, jobId: string, reason: string): Promise<unknown>;
}

export function createOperationsOverviewHandlers(identity: OverviewIdentity, operations: Overview) {
  const session = (request: Request) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return token;
  };
  const reader = async (request: Request, capability: Capability) => (await identity.requireCapability(session(request), capability)).id;
  /**
   * Any one operational read duty. Only a plain FORBIDDEN moves on to the next
   * candidate, so an expired session is never reported as a permission problem.
   */
  const anyOperator = async (request: Request) => {
    const sessionToken = session(request);
    let refusal: unknown;
    for (const capability of OVERVIEW_CAPABILITIES) {
      try { return (await identity.requireCapability(sessionToken, capability)).id; }
      catch (error) {
        if (!(error instanceof AuthError) || error.code !== "FORBIDDEN") throw error;
        refusal = error;
      }
    }
    throw refusal;
  };
  const retryActor = async (request: Request) => {
    assertSameOrigin(request);
    const sessionToken = session(request);
    const proofToken = readReauthProof(request);
    if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    return (await identity.authorizeCapabilityAction({ sessionToken, proofToken, capability: "OPERATIONS_TASK_RETRY" })).id;
  };
  const job = (jobId: string) => {
    const parsed = uuidSchema.safeParse(jobId);
    if (!parsed.success) throw new OperationError("JOB_NOT_FOUND", 404);
    return parsed.data;
  };

  return {
    overview: (request: Request) => execute(async () => {
      const actorId = await anyOperator(request);
      return json({ data: await operations.overview(actorId) });
    }),
    failedJobs: (request: Request) => execute(async () => {
      const actorId = await reader(request, "OPERATIONS_HEALTH_READ");
      return json({ data: { jobs: await operations.listFailedJobs(actorId) } });
    }),
    audit: (request: Request) => execute(async () => {
      // Filters are validated in the domain: an unknown value is refused rather
      // than dropped, so a narrowed trail can never silently widen.
      const url = new URL(request.url);
      const query = parseAuditQuery({
        actor: url.searchParams.get("actor"), targetType: url.searchParams.get("targetType"),
        targetId: url.searchParams.get("targetId"), group: url.searchParams.get("group"),
        action: url.searchParams.get("action"), result: url.searchParams.get("result"),
        from: url.searchParams.get("from"), to: url.searchParams.get("to"),
        correlationId: url.searchParams.get("correlationId"), limit: url.searchParams.get("limit"),
      });
      const actorId = await reader(request, "AUDIT_READ");
      return json({ data: { query: serializeQuery(query), events: await operations.listAudit(actorId, query) } });
    }),
    retryJob: (request: Request, jobId: string) => execute(async () => {
      const input = retrySchema.parse(await request.json());
      const actorId = await retryActor(request);
      return json({ data: await operations.retryJob(actorId, job(jobId), input.reason) });
    }),
  };
}

/** Echoes the filters that were actually applied, so the client can trust its own state. */
function serializeQuery(query: AuditQuery) {
  return { ...query, from: query.from?.toISOString() ?? null, to: query.to?.toISOString() ?? null };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  FORBIDDEN: "You do not have permission for this operation.",
  REAUTH_REQUIRED: "Confirm your password again before this operation.",
  JOB_NOT_FOUND: "That task was not found.",
  JOB_NOT_RETRYABLE: "Only a failed task can be queued again.",
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
