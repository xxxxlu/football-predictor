import {
  AuthError,
  INBOX_CAPABILITY,
  MUTE_DURATION_HOURS,
  parseGovernanceInboxQuery,
  REPORT_DISPOSITIONS,
  REPORT_SEVERITIES,
  type Capability,
  type GovernanceInboxQuery,
  type MuteDurationHours,
  type ReportDisposition,
  type ReportSeverity,
} from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { z } from "zod";
import { readReauthProof, readSessionToken } from "../../auth/_lib/handlers";
import { governanceReason } from "../../_lib/reason";
import { assertSameOrigin } from "../../_lib/request-origin";
import { requireAnyCapability, type OperatorResolver } from "../../_lib/operator-gate";

/**
 * Room and community governance inbox (FR81, FR83, FR90).
 *
 * Reads are gated on the shared inbox capability and then narrowed *by kind*
 * inside the repository, which is what keeps an operations-admin out of chat
 * reports and a community moderator out of room governance. Writes additionally
 * need a fresh re-auth proof and a written reason (NFR18).
 *
 * A write route cannot know which duty it needs before it knows the report's
 * kind, so it asks for identity confirmation plus *some* governance write duty
 * and lets the repository pin the exact one to the report inside the transaction.
 */

/** Governance write duties. The repository decides which one this report requires. */
const GOVERNANCE_WRITE_CAPABILITIES = ["ROOM_GOVERNANCE_WRITE", "COMMUNITY_GOVERNANCE_WRITE"] as const satisfies readonly Capability[];

const reasonField = governanceReason();
const resolutionSchema = z.object({
  disposition: z.enum(REPORT_DISPOSITIONS),
  reason: reasonField,
  muteHours: z.union(MUTE_DURATION_HOURS.map((hours) => z.literal(hours)) as [z.ZodLiteral<1>, z.ZodLiteral<24>, z.ZodLiteral<72>, z.ZodLiteral<168>]).optional(),
}).strict();
const triageSchema = z.object({
  assign: z.enum(["ME", "NONE"]).optional(),
  severity: z.enum(REPORT_SEVERITIES).optional(),
}).strict().refine((value) => value.assign !== undefined || value.severity !== undefined, { message: "nothing to change" });
const reasonSchema = z.object({ reason: reasonField }).strict();
const uuidSchema = z.string().uuid();

interface GovernanceIdentity extends OperatorResolver {
  requireCapability(sessionToken: string, capability: Capability): Promise<{ id: string }>;
  authorizeCapabilityAction(input: { sessionToken: string; proofToken: string; capability: Capability }): Promise<{ id: string }>;
}

interface GovernanceInbox {
  listReports(actorUserId: string, query: GovernanceInboxQuery): Promise<unknown>;
  getReport(actorUserId: string, reportId: string): Promise<unknown>;
  triageReport(actorUserId: string, reportId: string, input: { assign?: "ME" | "NONE"; severity?: ReportSeverity }): Promise<unknown>;
  resolveReport(actorUserId: string, reportId: string, input: { disposition: ReportDisposition; reason: string; muteHours?: MuteDurationHours }): Promise<unknown>;
  liftMute(actorUserId: string, reportId: string, reason: string): Promise<unknown>;
}

export function createGovernanceInboxHandlers(identity: GovernanceIdentity, inbox: GovernanceInbox) {
  const session = (request: Request) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return token;
  };
  const reader = async (request: Request) => (await identity.requireCapability(session(request), INBOX_CAPABILITY)).id;
  /**
   * Identity confirmation plus at least one governance write duty. Only a plain
   * FORBIDDEN moves on to the next candidate — an expired proof stays a
   * REAUTH_REQUIRED rather than being reported as a permission problem.
   *
   * Left as a loop, unlike the read gates: this needs a *named* capability for
   * the re-auth-gated call that follows, so resolving separately first would add
   * a session read in the common case rather than remove one. The list is two
   * long, so the worst case is two.
   */
  const writer = async (request: Request) => {
    assertSameOrigin(request);
    const sessionToken = session(request);
    const proofToken = readReauthProof(request);
    if (!proofToken) throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation.");
    let refusal: unknown;
    for (const capability of GOVERNANCE_WRITE_CAPABILITIES) {
      try { return (await identity.authorizeCapabilityAction({ sessionToken, proofToken, capability })).id; }
      catch (error) {
        if (!(error instanceof AuthError) || error.code !== "FORBIDDEN") throw error;
        refusal = error;
      }
    }
    throw refusal;
  };
  /** Triage changes nothing a member can see, so it needs the duty but no proof. */
  const triager = async (request: Request) => {
    assertSameOrigin(request);
    return (await requireAnyCapability(identity, session(request), GOVERNANCE_WRITE_CAPABILITIES)).actorId;
  };
  const report = (reportId: string) => {
    const parsed = uuidSchema.safeParse(reportId);
    if (!parsed.success) throw new OperationError("REPORT_NOT_FOUND", 404);
    return parsed.data;
  };

  return {
    list: (request: Request) => execute(async () => {
      // Filters are validated in the domain: an unknown value is refused rather
      // than dropped, so a narrowed queue can never silently widen.
      const url = new URL(request.url);
      const query = parseGovernanceInboxQuery({
        kind: url.searchParams.get("kind"), status: url.searchParams.get("status"),
        severity: url.searchParams.get("severity"), assignee: url.searchParams.get("assignee"),
        limit: url.searchParams.get("limit"),
      });
      const actorId = await reader(request);
      return json({ data: { actorId, query, reports: await inbox.listReports(actorId, query) } });
    }),
    detail: (request: Request, reportId: string) => execute(async () => {
      const actorId = await reader(request);
      return json({ data: await inbox.getReport(actorId, report(reportId)) });
    }),
    // Authorize before reading the body throughout: parsing first answered an
    // unauthenticated, cross-origin caller with field-level 422s, which let them
    // enumerate the disposition vocabulary and the reason bounds without a session.
    triage: (request: Request, reportId: string) => execute(async () => {
      const actorId = await triager(request);
      const input = triageSchema.parse(await request.json());
      return json({ data: await inbox.triageReport(actorId, report(reportId), input) });
    }),
    resolve: (request: Request, reportId: string) => execute(async () => {
      const actorId = await writer(request);
      const input = resolutionSchema.parse(await request.json());
      return json({ data: await inbox.resolveReport(actorId, report(reportId), input) });
    }),
    liftMute: (request: Request, reportId: string) => execute(async () => {
      const actorId = await writer(request);
      const input = reasonSchema.parse(await request.json());
      return json({ data: await inbox.liftMute(actorId, report(reportId), input.reason) });
    }),
  };
}

/**
 * The other side of a disposition: the explanation owed to the member it landed
 * on (AC4). No operator duty is involved — an account reads and clears its own
 * notices, and the repository scopes every query to the holder.
 */
export function createGovernanceNoticeHandlers(identity: { authenticate(token: string): Promise<{ id: string } | null> }, inbox: { listNotices(userId: string): Promise<unknown>; markNoticeRead(userId: string, noticeId: string): Promise<unknown> }) {
  const holder = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  return {
    list: (request: Request) => execute(async () => json({ data: { notices: await inbox.listNotices(await holder(request)) } })),
    markRead: (request: Request, noticeId: string) => execute(async () => {
      assertSameOrigin(request);
      const parsed = uuidSchema.safeParse(noticeId);
      if (!parsed.success) throw new OperationError("NOTICE_NOT_FOUND", 404);
      return json({ data: await inbox.markNoticeRead(await holder(request), parsed.data) });
    }),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  FORBIDDEN: "You do not have permission for this operation.",
  REAUTH_REQUIRED: "Confirm your password again before this operation.",
  REPORT_NOT_FOUND: "The requested report was not found.",
  REPORT_ALREADY_CLOSED: "That report has already been decided.",
  ROOM_ALREADY_IN_STATE: "That room is already in the state this decision would set.",
  REPORT_TRANSITION_INVALID: "That report cannot move to the requested state.",
  MESSAGE_NOT_HIDDEN: "That message is not currently hidden.",
  MUTE_ALREADY_ACTIVE: "That member already has an active mute in this room.",
  MUTE_NOT_ACTIVE: "There is no active mute to lift for this report.",
  MUTE_DURATION_REQUIRED: "Choose how long the mute should last.",
  NOTICE_NOT_FOUND: "That notice was not found.",
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
