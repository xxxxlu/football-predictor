import { authorizeF1Read, f1Failure, f1Json, getF1Repository } from "../_lib/runtime";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  try {
    const drivers = await getF1Repository().listDrivers();
    return f1Json(drivers);
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 entry list is temporarily unavailable", 503);
  }
}
