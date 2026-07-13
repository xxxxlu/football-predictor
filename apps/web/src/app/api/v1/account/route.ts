import { moderationHandlers } from "../_lib/moderation-runtime";
export const runtime = "nodejs";
export const DELETE = (request: Request) => moderationHandlers().deleteAccount(request);
