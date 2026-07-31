import { chatHandlers } from "../../../../_lib/chat-runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ roomId: string; messageId: string }> }) => context.params.then(({ roomId, messageId }) => chatHandlers().report(request, roomId, messageId));
