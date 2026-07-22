import { f1AdminHandlers } from "../../../../../../_lib/f1-admin-runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ sessionId: string }> }) =>
  context.params.then(({ sessionId }) => f1AdminHandlers().confirmResult(request, sessionId));
