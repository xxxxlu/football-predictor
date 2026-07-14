import { describe, expect, it } from "vitest";
import { ApiFootballClient } from "./index.js";

describe("API-FOOTBALL adapter", () => {
  it("maps fixture snapshots and reports quota response headers", async () => {
    const requests: Request[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json(
        {
          errors: [],
          response: [{ fixture: { id: 101, date: "2026-07-13T12:00:00+00:00", timestamp: 1783944000, status: { short: "NS" } }, league: { id: 1, name: "World Cup", season: 2026 }, teams: { home: { id: 10, name: "Home" }, away: { id: 20, name: "Away" } } }],
        },
        { headers: { "x-ratelimit-requests-limit": "100", "x-ratelimit-requests-remaining": "89" } },
      );
    };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher, now: () => new Date("2026-07-13T10:00:00Z") });

    const result = await client.fetchFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" });

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-apisports-key")).toBe("secret");
    expect(result.quota).toEqual({ supplierLimit: 100, supplierRemaining: 89 });
    expect(result.data[0]).toMatchObject({ supplierFixtureId: 101, kickoffAt: "2026-07-13T12:00:00.000Z", status: "SCHEDULED" });
  });

  it("maps a stable confirmed final result for settlement scanning", async () => {
    const payload = {
      errors: [],
      response: [{
        fixture: { id: 101, date: "2026-07-13T12:00:00+00:00", status: { short: "FT" } },
        goals: { home: 2, away: 1 },
        league: { id: 1, name: "World Cup", season: 2026 },
        teams: { home: { id: 10, name: "Home" }, away: { id: 20, name: "Away" } },
      }],
    };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher: async () => Response.json(payload), now: () => new Date("2026-07-13T14:00:00Z") });
    const first = await client.fetchFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" });
    const second = await client.fetchFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" });
    expect(first.data[0]?.result).toMatchObject({ confirmed: true, homeScore: 2, awayScore: 1 });
    expect(first.data[0]?.result?.version).toBe(second.data[0]?.result?.version);
  });

  it("maps only the requested bookmaker Match Winner 1X2 market", async () => {
    const fetcher: typeof fetch = async () => Response.json({ errors: [], response: [{ fixture: { id: 101 }, update: "2026-07-13T10:00:00+00:00", bookmakers: [{ id: 8, name: "Bookmaker", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.40" }] }] }, { id: 9, name: "Other", bets: [] }] }] });
    const client = new ApiFootballClient({ apiKey: "secret", fetcher, now: () => new Date("2026-07-13T10:00:30Z") });

    const result = await client.fetchPrematchOdds({ fixtureId: 101, bookmakerId: 8 });

    expect(result.data).toMatchObject({ productMarketId: "api-football:101:bookmaker:8:market:1", supplierFixtureId: 101, bookmakerId: 8, marketId: 1, dataAsOf: "2026-07-13T10:00:00.000Z" });
    expect(result.data?.outcomes.map((outcome) => outcome.selection)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("fetches a paged league/date odds batch so one request can warm multiple fixtures", async () => {
    let url = "";
    const fetcher: typeof fetch = async (input) => {
      url = String(input);
      return Response.json({
        errors: [],
        paging: { current: 1, total: 2 },
        response: [
          { fixture: { id: 101 }, update: "2026-07-13T10:00:00+00:00", bookmakers: [{ id: 8, name: "Bookmaker", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.40" }] }] }] },
          { fixture: { id: 102 }, update: "2026-07-13T10:01:00+00:00", bookmakers: [{ id: 8, name: "Bookmaker", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.90" }, { value: "Draw", odd: "3.10" }, { value: "Away", odd: "4.20" }] }] }] },
        ],
      });
    };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher, now: () => new Date("2026-07-13T10:02:00Z") });

    const result = await client.fetchPrematchOddsPage({ leagueId: 39, season: 2026, date: "2026-07-13", bookmakerId: 8, page: 1 });

    expect(url).toBe("https://v3.football.api-sports.io/odds?league=39&season=2026&date=2026-07-13&timezone=UTC&bookmaker=8&bet=1&page=1");
    expect(result.paging).toEqual({ current: 1, total: 2 });
    expect(result.data.map((item) => item.fixtureId)).toEqual(["api-football:101", "api-football:102"]);
  });

  it("uses the non-billable status endpoint for quota calibration", async () => {
    let url = "";
    const fetcher: typeof fetch = async (input) => {
      url = String(input);
      return Response.json({ errors: [], response: { requests: { current: 12, limit_day: 100 } } });
    };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher });

    await expect(client.fetchStatus()).resolves.toEqual({ supplierCurrent: 12, supplierLimit: 100 });
    expect(url).toBe("https://v3.football.api-sports.io/status");
  });

  it("maps cached live score and in-play odds as read-only data", async () => {
    let url = "";
    const fetcher: typeof fetch = async (input) => {
      url = String(input);
      return Response.json({ errors: [], response: [{ fixture: { id: 101, status: { elapsed: 62 } }, teams: { home: { goals: 1 }, away: { goals: 0 } }, update: "2026-07-13T11:22:00+00:00", bets: [{ id: 59, name: "Fulltime Result", values: [{ value: "Home", odd: "1.60", suspended: false }] }] }] });
    };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher, now: () => new Date("2026-07-13T11:22:05Z") });

    const result = await client.fetchLive({ fixtureId: 101, bookmakerId: 8 });

    expect(url).toBe("https://v3.football.api-sports.io/odds/live?fixture=101");
    expect(result.data).toMatchObject({ homeScore: 1, awayScore: 0, minute: 62, dataAsOf: "2026-07-13T11:22:00.000Z" });
    expect(result.data?.markets[0]).toMatchObject({ supplierMarketId: 59, name: "Fulltime Result" });
  });

  it("rejects supplier error payloads without leaking the API key", async () => {
    const client = new ApiFootballClient({ apiKey: "do-not-leak", fetcher: async () => Response.json({ errors: { token: "Invalid token" }, response: [] }, { status: 401 }) });

    await expect(client.fetchFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" })).rejects.toThrow("API-FOOTBALL request failed");
    await expect(client.fetchFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" })).rejects.not.toThrow("do-not-leak");
  });
});
