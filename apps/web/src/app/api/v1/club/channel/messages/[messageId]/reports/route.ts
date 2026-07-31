import { lobbyHandlers } from "../../../../../_lib/lobby-runtime";
export const runtime = "nodejs";
export const POST = async (request: Request, context: { params: Promise<{ messageId: string }> }) =>
  lobbyHandlers().messageReport(request, (await context.params).messageId);
