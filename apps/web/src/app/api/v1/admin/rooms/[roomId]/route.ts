import { moderationHandlers } from "../../../_lib/moderation-runtime";
export const runtime = "nodejs";
export const PATCH = (request: Request, context: { params: Promise<{ roomId: string }> }) => context.params.then(({ roomId }) => moderationHandlers().moderateRoom(request, roomId));
