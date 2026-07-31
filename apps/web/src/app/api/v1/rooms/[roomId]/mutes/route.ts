import { chatHandlers } from "../../_lib/chat-runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ roomId: string }> }) => context.params.then(({ roomId }) => chatHandlers().mute(request, roomId));
