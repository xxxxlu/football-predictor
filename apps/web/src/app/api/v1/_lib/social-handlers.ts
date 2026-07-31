import { OperationError } from "@pulse/db";
import { AuthError, RESPOND_ACTIONS, type PresencePreferences, type RespondAction } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/handlers";
import { assertSameOrigin } from "./request-origin";

/**
 * Friends, blocks, privacy and presence routes (Story 12.1). Transport only:
 * origin check first, then authentication, then body validation — every
 * decision that matters lives in @pulse/domain and the repository. Anonymity
 * rules (blocked = same shape as pending, unknown id = REQUEST_NOT_FOUND) are
 * enforced below the transport, so nothing here needs a special "blocked" path.
 */
const pulseIdSchema = z
  .object({ pulseId: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/) })
  .strict();
const respondSchema = z.object({ action: z.enum(RESPOND_ACTIONS) }).strict();
const privacySchema = z
  .object({
    showOnlineToFriends: z.boolean().optional(),
    showLobbyToFriends: z.boolean().optional(),
    showInLobbyDirectory: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined));
/** 12.4: a lobby page heartbeat declares its surface; anything else is a plain online beat. */
const heartbeatSchema = z.object({ surface: z.literal("lobby").optional() }).strict();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
}
interface Social {
  requestFriend(requesterId: string, pulseId: string): Promise<unknown>;
  respondToFriendRequest(responderId: string, requestId: string, action: RespondAction): Promise<unknown>;
  removeFriend(userId: string, friendUserId: string): Promise<{ removed: boolean }>;
  listFriends(userId: string): Promise<unknown>;
  listFriendRequests(userId: string): Promise<unknown>;
  blockUser(blockerId: string, pulseId: string): Promise<unknown>;
  unblockUser(blockerId: string, blockedUserId: string): Promise<{ unblocked: boolean }>;
  listBlocks(blockerId: string): Promise<unknown>;
  getPrivacyPreferences(userId: string): Promise<PresencePreferences>;
  updatePrivacyPreferences(userId: string, patch: Partial<PresencePreferences>): Promise<PresencePreferences>;
  recordHeartbeat(userId: string, surface?: "lobby"): Promise<{ recorded: boolean }>;
}

export function createSocialHandlers(identity: Identity, social: Social) {
  const user = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  const read = (operation: (id: string) => Promise<unknown>) => (request: Request) =>
    execute(async () => json({ data: await operation(await user(request)) }));

  return {
    friendsList: read((id) => social.listFriends(id)),
    requestsList: read((id) => social.listFriendRequests(id)),
    blocksList: read((id) => social.listBlocks(id)),
    privacyGet: read((id) => social.getPrivacyPreferences(id)),

    requestCreate: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = pulseIdSchema.parse(await request.json());
        return json({ data: await social.requestFriend(id, input.pulseId) });
      }),

    requestRespond: (request: Request, requestId: string) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        // A malformed id answers exactly like a foreign one — never a validation hint.
        if (!UUID_PATTERN.test(requestId)) throw new OperationError("REQUEST_NOT_FOUND", 404);
        const input = respondSchema.parse(await request.json());
        return json({ data: await social.respondToFriendRequest(id, requestId, input.action) });
      }),

    friendRemove: (request: Request, userId: string) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        if (!UUID_PATTERN.test(userId) || userId === id) return json({ data: { removed: false } });
        return json({ data: await social.removeFriend(id, userId) });
      }),

    blockCreate: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = pulseIdSchema.parse(await request.json());
        return json({ data: await social.blockUser(id, input.pulseId) });
      }),

    blockRemove: (request: Request, userId: string) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        if (!UUID_PATTERN.test(userId)) return json({ data: { unblocked: false } });
        return json({ data: await social.unblockUser(id, userId) });
      }),

    privacyPatch: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = privacySchema.parse(await request.json());
        return json({ data: await social.updatePrivacyPreferences(id, input) });
      }),

    heartbeat: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        // The body is optional — the 12.1 clients send none. A present body
        // must still parse strictly.
        const raw = (await request.text()).trim();
        const input = raw === "" ? {} : heartbeatSchema.parse(JSON.parse(raw));
        return json({ data: await social.recordHeartbeat(id, input.surface) });
      }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthError || error instanceof OperationError) return failure(error.code, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    console.error("[social] unexpected failure", error);
    return failure("INTERNAL_ERROR", 500);
  }
}
function json(body: unknown) {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
function failure(code: string, status: number) {
  const message =
    code === "UNAUTHENTICATED" ? "Log in to continue."
    : code === "USER_NOT_FOUND" ? "No PULSE member matches that ID."
    : code === "SELF_FRIEND_FORBIDDEN" ? "You cannot add yourself as a friend."
    : code === "SELF_BLOCK_FORBIDDEN" ? "You cannot block yourself."
    : code === "RATE_LIMITED" ? "Too many friend requests. Try again later."
    : code === "REQUEST_NOT_FOUND" ? "The friend request was not found."
    : code === "INVALID_REQUEST" ? "Check the submitted fields and try again."
    : "The request could not be completed.";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
