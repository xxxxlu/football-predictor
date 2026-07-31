import { clubHandlers } from "../../../_lib/club-runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => clubHandlers().attemptPost(request);
