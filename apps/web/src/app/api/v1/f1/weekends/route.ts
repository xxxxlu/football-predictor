import { podiumOf } from "@/features/f1/stats";
import { authorizeF1Read, CURRENT_F1_SEASON, f1Failure, f1Json, getF1Repository, refreshF1ReadModel } from "../_lib/runtime";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  try {
    await refreshF1ReadModel();
    const repository = getF1Repository();
    const [weekends, confirmed] = await Promise.all([
      repository.listWeekends(CURRENT_F1_SEASON),
      repository.listConfirmedSessionResults(CURRENT_F1_SEASON),
    ]);
    const podiumBySession = new Map(confirmed.map((result) => [result.sessionId, podiumOf(result.classification)]));
    // Podium chips only for sessions that are actually FINISHED — a confirmed
    // result attached to a still-open session (inconsistent seed data) must not
    // present itself as an outcome.
    const enriched = weekends.map((weekend) => ({
      ...weekend,
      sessions: weekend.sessions.map((session) => ({
        ...session,
        podium: session.state === "FINISHED" ? podiumBySession.get(session.id) ?? null : null,
      })),
    }));
    return f1Json(enriched);
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 schedule is temporarily unavailable", 503);
  }
}
