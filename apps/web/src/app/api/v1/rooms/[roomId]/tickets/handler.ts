import { AuthError, RoomError, TicketSubmissionError, type PredictionSelection } from "@pulse/domain";
import { z } from "zod";
import { readSessionToken } from "../../../auth/_lib/handlers";
import { assertSameOrigin } from "../../../_lib/request-origin";

const bodySchema = z.object({
  matchId: z.string().min(1),
  marketId: z.union([z.string().min(1), z.number().int()]).transform(String),
  marketVersion: z.string().min(1),
  // Football (1X2 / correct score) or encoded F1 selections; domain validates the exact candidate set.
  selection: z.string().regex(/^(?:HOME|DRAW|AWAY|OTHER|\d{1,2}-\d{1,2}|DRV:[A-Z][A-Z0-9]{1,3}|PODIUM:[A-Z][A-Z0-9]{1,3}:(?:YES|NO)|POD3:[A-Z][A-Z0-9]{1,3}-[A-Z][A-Z0-9]{1,3}-[A-Z][A-Z0-9]{1,3}|H2H:[A-Z][A-Z0-9]{1,3}>[A-Z][A-Z0-9]{1,3})$/),
  stakePoints: z.union([z.string().regex(/^\d+$/), z.number().int()]).transform(Number),
  acceptedOdds: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
});

interface IdentityLookup { authenticate(token: string): Promise<{ id: string } | null> }
interface TicketApplication { submit(input: { userId: string; roomId: string; marketId: string; selection: PredictionSelection; stakePoints: number; acceptedOddsVersion: string; acceptedDecimalOdds: string; idempotencyKey: string }): Promise<{ id: string; status: string; stakePoints: number }> }

export function createTicketPost(identity: IdentityLookup, tickets: TicketApplication) {
  return async (request: Request, roomId: string) => {
    try {
      assertSameOrigin(request);
      const token = readSessionToken(request);
      const account = token ? await identity.authenticate(token) : null;
      if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      if (!idempotencyKey || idempotencyKey.length > 128) throw new AuthError("IDEMPOTENCY_KEY_REQUIRED", 422, "Retry with a valid Idempotency-Key.");
      const input = bodySchema.parse(await request.json());
      const ticket = await tickets.submit({
        userId: account.id,
        roomId,
        marketId: input.marketId,
        selection: input.selection as PredictionSelection,
        stakePoints: input.stakePoints,
        acceptedOddsVersion: input.marketVersion,
        acceptedDecimalOdds: input.acceptedOdds,
        idempotencyKey,
      });
      return Response.json({ data: { ticketId: ticket.id, status: ticket.status, stakePoints: ticket.stakePoints } }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof TicketSubmissionError) return ticketError(error);
      if (error instanceof AuthError || error instanceof RoomError) return failure(error.code, error.action ?? "The request could not be completed.", error.status);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return failure("INVALID_REQUEST", "Check the prediction fields and try again.", 422);
      return failure("INTERNAL_ERROR", "The prediction could not be submitted.", 500);
    }
  };
}

function ticketError(error: TicketSubmissionError) {
  const status = error.code === "DATA_UNAVAILABLE" ? 503
    : error.code === "MARKET_CLOSED" || error.code === "ODDS_CHANGED" || error.code === "SCORE_TICKET_EXISTS" || error.code === "MARKET_TICKET_EXISTS" ? 409
    : error.code === "ADVANCED_ROOM_REQUIRED" || error.code === "ROOM_SPORT_MISMATCH" ? 403 : 422;
  const messages: Record<TicketSubmissionError["code"], string> = {
    MARKET_CLOSED: "This market is closed. No points were frozen.",
    ODDS_CHANGED: "Odds changed. Confirm the latest odds and submit again.",
    DATA_UNAVAILABLE: "Verified fresh market data is unavailable. No points were frozen.",
    INSUFFICIENT_POINTS: "The room account does not have enough available points.",
    INVALID_STAKE: "Use a whole-number stake from 1 to 20,000 points.",
    ADVANCED_ROOM_REQUIRED: "Correct-score predictions are available in advanced rooms only.",
    ROOM_SPORT_MISMATCH: "This room predicts a different sport. Pick an event that matches the room's sport.",
    SCORE_TICKET_EXISTS: "You already have an open correct-score prediction on this match.",
    MARKET_TICKET_EXISTS: "You already predicted this market. Wait for the result to settle.",
  };
  return failure(error.code, messages[error.code], status);
}
function failure(code: string, message: string, status: number) { return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } }); }
