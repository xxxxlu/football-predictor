import { OperationError } from "@pulse/db";
import {
  AuthError,
  CHALLENGE_OPTION_KEYS,
  fortuneFor,
  productDay,
  questionForProductDay,
  toPublicQuestion,
  type BadgeKey,
  type ChallengeOptionKey,
} from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/handlers";
import { assertSameOrigin } from "./request-origin";

/**
 * Club daily challenge routes (Story 12.2). Transport only. The product day is
 * always derived from the server clock here — client dates never participate
 * (AC1) — and the question leaves this layer exclusively through
 * toPublicQuestion, whose type has no correct-answer field (AC2).
 */
// `questionKey` is the client echoing which question it displayed. It never
// selects the question (the server day does, AC1) — it only lets a submit that
// straddled the UTC rollover be refused instead of silently scored against the
// new day's question. Optional: the 12.2 clients did not send it.
const attemptSchema = z.object({ answer: z.enum(CHALLENGE_OPTION_KEYS), questionKey: z.string().min(1).max(64).optional() }).strict();

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Shape alone admits calendar-invalid days ("2026-02-31" sorts before today,
// then blows up in the PG date cast as a 500). Round-trip through Date pins
// the value to a real calendar day.
function isCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
}
interface Club {
  getDailyState(userId: string, day: string): Promise<{ attempt: unknown; profile: unknown; badges: BadgeKey[] }>;
  submitAttempt(userId: string, day: string, answer: ChallengeOptionKey): Promise<unknown>;
  listFriendResults(userId: string, day: string): Promise<unknown>;
  listRoomResults(userId: string, roomId: string, day: string): Promise<unknown>;
  hasAttempted(userId: string, day: string): Promise<boolean>;
}

export function createClubHandlers(identity: Identity, club: Club, now: () => Date = () => new Date()) {
  const user = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };

  return {
    dailyGet: (request: Request) =>
      execute(async () => {
        const id = await user(request);
        const day = productDay(now());
        const state = await club.getDailyState(id, day);
        // Spread first: the repository payload is typed `unknown`, and the
        // sanitized projections (question without its answer key, above all)
        // must always win over whatever keys the repository grows later.
        return json({
          data: {
            ...state,
            day,
            question: toPublicQuestion(questionForProductDay(day)),
            fortune: fortuneFor(id, day),
          },
        });
      }),

    attemptPost: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = attemptSchema.parse(await request.json());
        const day = productDay(now());
        if (input.questionKey !== undefined && input.questionKey !== questionForProductDay(day).key) {
          return failure("DAY_ROLLED_OVER", 409);
        }
        return json({ data: await club.submitAttempt(id, day, input.answer) });
      }),

    resultsGet: (request: Request) =>
      execute(async () => {
        const id = await user(request);
        const url = new URL(request.url);
        const today = productDay(now());
        const dayParam = url.searchParams.get("day")?.trim();
        if (dayParam !== undefined && dayParam !== "" && (!isCalendarDay(dayParam) || dayParam > today)) {
          return failure("INVALID_REQUEST", 422);
        }
        const day = dayParam || today;
        const roomId = url.searchParams.get("roomId")?.trim() || undefined;
        if (roomId !== undefined && !UUID_PATTERN.test(roomId)) throw new OperationError("ROOM_NOT_FOUND", 404);

        // AC2 gate, server-side: results open once the viewer has submitted
        // for that day, or the product day is already over. A locked response
        // carries no other member's data at all — not hidden data.
        const open = day < today || (await club.hasAttempted(id, day));
        if (!open) return json({ data: { locked: true, friends: [], room: null } });
        const [friends, room] = await Promise.all([
          club.listFriendResults(id, day),
          roomId ? club.listRoomResults(id, roomId, day) : Promise.resolve(null),
        ]);
        return json({ data: { locked: false, friends, room } });
      }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthError || error instanceof OperationError) return failure(error.code, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", 422);
    console.error("[club] unexpected failure", error);
    return failure("INTERNAL_ERROR", 500);
  }
}
function json(body: unknown) {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
function failure(code: string, status: number) {
  const message =
    code === "UNAUTHENTICATED" ? "Log in to continue."
    : code === "ROOM_NOT_FOUND" ? "The requested room was not found."
    : code === "DAY_ROLLED_OVER" ? "A new challenge day has started. Reload for today's question."
    : code === "INVALID_REQUEST" ? "Check the submitted fields and try again."
    : code === "INVALID_ORIGIN" ? "Reload this page and try again."
    : "The request could not be completed.";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
