import { OperationError } from "@pulse/db";
import { CHALLENGE_BANK, questionForProductDay } from "@pulse/domain";
import { describe, expect, it, vi } from "vitest";
import { createClubHandlers } from "./club-handlers.js";

const NOW = () => new Date("2026-07-31T10:00:00.000Z");
const DAY = "2026-07-31";
const ROOM = "dddddddd-0000-0000-0000-000000000004";

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { cookie: "fp_session=token", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const club = {
    getDailyState: vi.fn().mockResolvedValue({ attempt: null, profile: { xpTotal: 0, currentStreak: 0, bestStreak: 0, lastAnsweredDay: null }, badges: [] }),
    submitAttempt: vi.fn().mockResolvedValue({ replayed: false, attempt: { productDay: DAY, answer: "A", isCorrect: true, xpAwarded: 11, streakAfter: 1 }, profile: {}, newBadges: [] }),
    listFriendResults: vi.fn().mockResolvedValue([{ pulseId: "bob", nickname: null, answered: true, correct: true, streak: 2 }]),
    listRoomResults: vi.fn().mockResolvedValue([]),
    hasAttempted: vi.fn().mockResolvedValue(true),
  };
  return { identity, club, handlers: createClubHandlers(identity, club, NOW) };
}

describe("club API authentication", () => {
  it("refuses every route without a session before touching the repository", async () => {
    const subject = setup();
    subject.identity.authenticate.mockResolvedValue(null);
    const responses = await Promise.all([
      subject.handlers.dailyGet(get("/api/v1/club/daily")),
      subject.handlers.attemptPost(post("/api/v1/club/daily/attempt", { answer: "A" })),
      subject.handlers.resultsGet(get("/api/v1/club/daily/results")),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    for (const call of Object.values(subject.club)) expect(call).not.toHaveBeenCalled();
  });

  it("refuses cross-origin submissions before authentication runs", async () => {
    const subject = setup();
    const response = await subject.handlers.attemptPost(
      post("/api/v1/club/daily/attempt", { answer: "A" }, { origin: "https://evil.test" }),
    );
    expect(response.status).toBe(403);
    expect(subject.identity.authenticate).not.toHaveBeenCalled();
  });
});

describe("daily GET", () => {
  it("serves the server-day question and never any correct answer value", async () => {
    const subject = setup();
    const response = await subject.handlers.dailyGet(get("/api/v1/club/daily"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { day: string; question: { key: string } } };
    expect(body.data.day).toBe(DAY);
    const question = questionForProductDay(DAY);
    expect(body.data.question.key).toBe(question.key);
    // Structural secrecy: the serialized response has no correct-answer field,
    // and no bare option-key value outside the options array.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("correctOption");
    expect(raw).not.toContain("answerKey");
  });

  it("keeps every response no-store", async () => {
    const subject = setup();
    const response = await subject.handlers.dailyGet(get("/api/v1/club/daily"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("attempt POST", () => {
  it("accepts only the four option keys and no extra fields", async () => {
    const subject = setup();
    for (const body of [{ answer: "E" }, { answer: "a" }, { answer: "A", extra: 1 }, {}]) {
      expect((await subject.handlers.attemptPost(post("/x", body))).status).toBe(422);
    }
    expect(subject.club.submitAttempt).not.toHaveBeenCalled();
    const response = await subject.handlers.attemptPost(post("/x", { answer: "B" }));
    expect(response.status).toBe(200);
    // The server clock decides the day; the client never sends one.
    expect(subject.club.submitAttempt).toHaveBeenCalledWith("user-1", DAY, "B");
  });

  it("returns the same recorded state for a repeat submission", async () => {
    const subject = setup();
    const recorded = { replayed: true, attempt: { productDay: DAY, answer: "C", isCorrect: false, xpAwarded: 0, streakAfter: 0 }, profile: {}, newBadges: [] };
    subject.club.submitAttempt.mockResolvedValue(recorded);
    const first = await subject.handlers.attemptPost(post("/x", { answer: "A" }));
    const second = await subject.handlers.attemptPost(post("/x", { answer: "B" }));
    expect(await first.json()).toEqual(await second.json());
  });
});

describe("results GET", () => {
  it("answers a locked shell — not hidden data — when the viewer has not submitted today", async () => {
    const subject = setup();
    subject.club.hasAttempted.mockResolvedValue(false);
    const response = await subject.handlers.resultsGet(get("/api/v1/club/daily/results"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { locked: true, friends: [], room: null } });
    expect(subject.club.listFriendResults).not.toHaveBeenCalled();
    expect(subject.club.listRoomResults).not.toHaveBeenCalled();
  });

  it("opens after submission, and for past product days without one", async () => {
    const submitted = setup();
    const response = await submitted.handlers.resultsGet(get("/api/v1/club/daily/results"));
    expect(((await response.json()) as { data: { locked: boolean } }).data.locked).toBe(false);
    expect(submitted.club.listFriendResults).toHaveBeenCalledWith("user-1", DAY);

    const pastDay = setup();
    pastDay.club.hasAttempted.mockResolvedValue(false);
    const past = await pastDay.handlers.resultsGet(get("/api/v1/club/daily/results?day=2026-07-30"));
    expect(((await past.json()) as { data: { locked: boolean } }).data.locked).toBe(false);
    expect(pastDay.club.hasAttempted).not.toHaveBeenCalled();
  });

  it("rejects future or malformed day parameters", async () => {
    const subject = setup();
    for (const day of ["2026-08-01", "tomorrow", "2026-8-1"]) {
      expect((await subject.handlers.resultsGet(get(`/api/v1/club/daily/results?day=${day}`))).status).toBe(422);
    }
  });

  it("scopes room results to members and hides unknown rooms as 404", async () => {
    const subject = setup();
    await subject.handlers.resultsGet(get(`/api/v1/club/daily/results?roomId=${ROOM}`));
    expect(subject.club.listRoomResults).toHaveBeenCalledWith("user-1", ROOM, DAY);

    const denied = setup();
    denied.club.listRoomResults.mockRejectedValue(new OperationError("ROOM_NOT_FOUND", 404));
    expect((await denied.handlers.resultsGet(get(`/api/v1/club/daily/results?roomId=${ROOM}`))).status).toBe(404);

    const malformed = setup();
    expect((await malformed.handlers.resultsGet(get("/api/v1/club/daily/results?roomId=not-a-uuid"))).status).toBe(404);
    expect(malformed.club.listRoomResults).not.toHaveBeenCalled();
  });
});

describe("bank sanity at the transport boundary", () => {
  it("has a question for every day of a long window (no empty days)", () => {
    for (let offset = 0; offset < 60; offset++) {
      const day = new Date(Date.UTC(2026, 6, 1 + offset)).toISOString().slice(0, 10);
      expect(CHALLENGE_BANK.some((question) => question.key === questionForProductDay(day).key)).toBe(true);
    }
  });
});
