import { authorizeF1Read, CURRENT_F1_SEASON, f1Failure, f1Json, getF1Repository } from "../_lib/runtime";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  try {
    const weekends = await getF1Repository().listWeekends(CURRENT_F1_SEASON);
    return f1Json(weekends);
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 schedule is temporarily unavailable", 503);
  }
}
