import { chatHandlers } from "../../../_lib/chat-runtime";
export const runtime = "nodejs";
export const DELETE = (request: Request, context: { params: Promise<{ roomId: string; muteId: string }> }) => context.params.then(({ roomId, muteId }) => chatHandlers().unmute(request, roomId, muteId));
