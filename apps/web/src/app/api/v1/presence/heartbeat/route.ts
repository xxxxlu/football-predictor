import { socialHandlers } from "../../_lib/social-runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => socialHandlers().heartbeat(request);
