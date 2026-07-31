import { OperationError } from "@pulse/db";
import { AuthError, normalizeMessageBody, productDay } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/handlers";
import { governanceReason } from "./reason";
import { assertSameOrigin } from "./request-origin";

/**
 * PULSE CLUB lobby and public channel routes (Story 12.4, FR89). Transport
 * only: origin check first on writes, then authentication, then body
 * validation. Every gate that matters — rules confirmation, community mute,
 * rate window, block filtering — lives in the repository, in SQL.
 *
 * The lobby aggregate degrades per section: one failed read nulls its own
 * block and names it under `failedSections`, instead of taking the page down.
 */

// 500 code points is the real bound (counted after normalization); the schema
// cap just refuses megabyte bodies before they are trimmed and counted.
const sendSchema = z.object({ body: z.string().max(4000) }).strict();
// Same floor as every report form: ten code points of actual explanation.
const reportSchema = z.object({ reason: governanceReason(10) }).strict();
const uuidSchema = z.string().uuid();

interface LobbyIdentity { authenticate(token: string): Promise<{ id: string } | null> }
interface ClubChannel {
  listMessages(viewerId: string, options: { cursor?: string }): Promise<{ cursor: string | null } & Record<string, unknown>>;
  sendMessage(userId: string, body: string): Promise<unknown>;
  lobbyDirectory(viewerId: string): Promise<unknown>;
  friendActivity(viewerId: string, productDay: string): Promise<unknown>;
  getCommunityRulesStatus(userId: string): Promise<unknown>;
  acceptCommunityRules(userId: string): Promise<unknown>;
}
interface ChannelReports {
  reportChannelMessage(input: { messageId: string; reporterUserId: string; reason: string }): Promise<unknown>;
}

export function createLobbyHandlers(identity: LobbyIdentity, channel: ClubChannel, reports: ChannelReports, now: () => Date = () => new Date()) {
  const userId = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  const message = (messageId: string) => {
    const parsed = uuidSchema.safeParse(messageId);
    if (!parsed.success) throw new OperationError("MESSAGE_NOT_FOUND", 404);
    return parsed.data;
  };

  return {
    /** One aggregate read for the lobby page; each section degrades alone. */
    lobby: (request: Request) => execute(async () => {
      const accountId = await userId(request);
      const day = productDay(now());
      const [directory, friends, channelPage] = await Promise.allSettled([
        channel.lobbyDirectory(accountId),
        channel.friendActivity(accountId, day),
        channel.listMessages(accountId, {}),
      ]);
      const failedSections: string[] = [];
      const section = <T>(result: PromiseSettledResult<T>, name: string): T | null => {
        if (result.status === "fulfilled") return result.value;
        failedSections.push(name);
        console.error(`[club-lobby] ${name} section failed`, result.reason);
        return null;
      };
      return json({
        data: {
          day,
          directory: section(directory, "directory"),
          friends: section(friends, "friends"),
          channel: section(channelPage, "channel"),
          failedSections,
        },
      });
    }),

    messagesList: (request: Request) => execute(async () => {
      const accountId = await userId(request);
      const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
      const { cursor: nextCursor, ...data } = await channel.listMessages(accountId, { cursor });
      return json({ data, meta: { cursor: nextCursor } });
    }),

    messagesSend: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = sendSchema.parse(await request.json());
      const body = normalizeMessageBody(input.body);
      if (!body) throw new OperationError("MESSAGE_INVALID", 422);
      return json({ data: await channel.sendMessage(accountId, body) }, 201);
    }),

    messageReport: (request: Request, messageId: string) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      const input = reportSchema.parse(await request.json());
      return json({ data: await reports.reportChannelMessage({ messageId: message(messageId), reporterUserId: accountId, reason: input.reason }) }, 201);
    }),

    rulesGet: (request: Request) => execute(async () => {
      const accountId = await userId(request);
      return json({ data: await channel.getCommunityRulesStatus(accountId) });
    }),

    rulesAccept: (request: Request) => execute(async () => {
      assertSameOrigin(request);
      const accountId = await userId(request);
      return json({ data: await channel.acceptCommunityRules(accountId) });
    }),
  };
}

const noStore = { "cache-control": "no-store" };
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  RULES_CONFIRMATION_REQUIRED: "Confirm the community rules to post in the channel.",
  COMMUNITY_MUTED: "You are muted in the PULSE CLUB channel right now.",
  RATE_LIMITED: "You are sending messages too quickly. Wait a moment.",
  DUPLICATE_MESSAGE: "That is the same as your last message.",
  MESSAGE_INVALID: "Messages are 1 to 500 characters.",
  MESSAGE_NOT_FOUND: "That message was not found.",
  SELF_REPORT_FORBIDDEN: "You cannot report your own message.",
  REPORT_ALREADY_OPEN: "You already have an open report for this message.",
  USER_NOT_FOUND: "Log in to continue.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
};

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStore }); }
async function execute(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status, error.action);
    if (error instanceof OperationError) return failure(error.code, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    console.error("[club-lobby] unexpected failure", error);
    return failure("INTERNAL_ERROR", 500);
  }
}
function failure(code: string, status: number, action?: string) {
  return Response.json({ error: { code, message: action ?? MESSAGES[code] ?? "The request could not be completed." } }, { status, headers: noStore });
}
