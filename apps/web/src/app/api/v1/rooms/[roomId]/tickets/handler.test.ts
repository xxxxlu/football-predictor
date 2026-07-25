import { describe, expect, it, vi } from "vitest";
import { TicketSubmissionError } from "@pulse/domain";
import { createTicketPost } from "./handler.js";

const request = (body: unknown, idempotencyKey = "request-1", cookie = "fp_session=session-token") => new Request("https://example.test/api/v1/rooms/room-1/tickets", {
  method: "POST", headers: { "content-type": "application/json", cookie, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, body: JSON.stringify(body),
});
const body = { matchId: "fixture-1", marketId: "market-1", marketVersion: "odds-v2", selection: "HOME", stakePoints: "1000", acceptedOdds: "2.10" };

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const tickets = { submit: vi.fn().mockResolvedValue({ id: "ticket-1", status: "PENDING", stakePoints: 1000 }) };
  return { identity, tickets, post: createTicketPost(identity, tickets) };
}

describe("POST room ticket", () => {
  it("maps the frontend contract and Idempotency-Key to the domain command", async () => {
    const { post, tickets } = setup();
    const response = await post(request(body), "room-1");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { ticketId: "ticket-1", status: "PENDING", stakePoints: 1000 } });
    expect(tickets.submit).toHaveBeenCalledWith({ userId: "user-1", roomId: "room-1", marketId: "market-1", selection: "HOME", stakePoints: 1000, acceptedOddsVersion: "odds-v2", acceptedDecimalOdds: "2.10", idempotencyKey: "request-1" });
  });

  it("requires an active session and an Idempotency-Key", async () => {
    const first = setup(); first.identity.authenticate.mockResolvedValueOnce(null);
    expect((await first.post(request(body), "room-1")).status).toBe(401);
    expect((await setup().post(request(body, ""), "room-1")).status).toBe(422);
  });

  it("maps domain rejection codes without reporting a successful freeze", async () => {
    const { post, tickets } = setup(); tickets.submit.mockRejectedValueOnce(new TicketSubmissionError("ODDS_CHANGED"));
    const response = await post(request(body), "room-1");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ODDS_CHANGED" } });
  });
});
