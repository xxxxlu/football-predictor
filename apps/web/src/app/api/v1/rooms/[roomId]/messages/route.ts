import { chatHandlers } from "../../_lib/chat-runtime";
export const runtime = "nodejs";
export const GET = (request: Request, context: { params: Promise<{ roomId: string }> }) => context.params.then(({ roomId }) => chatHandlers().list(request, roomId));
export const POST = (request: Request, context: { params: Promise<{ roomId: string }> }) => context.params.then(({ roomId }) => chatHandlers().send(request, roomId));
