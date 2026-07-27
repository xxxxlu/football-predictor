import { authorizeF1Read, f1Failure, f1Json, getF1Repository, refreshF1ReadModel } from "../../_lib/runtime";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  const { sessionId } = await context.params;
  if (!UUID.test(sessionId)) return f1Failure("SESSION_NOT_FOUND", "The requested F1 session was not found.", 404);
  try {
    await refreshF1ReadModel();
    const detail = await getF1Repository().getSessionDetail(sessionId);
    if (!detail) return f1Failure("SESSION_NOT_FOUND", "The requested F1 session was not found.", 404);
    return f1Json(detail);
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 session data is temporarily unavailable", 503);
  }
}
