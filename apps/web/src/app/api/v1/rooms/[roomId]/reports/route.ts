import { moderationHandlers } from "../../../_lib/moderation-runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ roomId: string }> }) => context.params.then(({ roomId }) => moderationHandlers().reportRoom(request, roomId));
