import { socialHandlers } from "../_lib/social-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => socialHandlers().friendsList(request);
