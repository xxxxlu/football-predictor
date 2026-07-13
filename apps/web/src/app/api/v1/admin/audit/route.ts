import { moderationHandlers } from "../../_lib/moderation-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => moderationHandlers().listAudit(request);
