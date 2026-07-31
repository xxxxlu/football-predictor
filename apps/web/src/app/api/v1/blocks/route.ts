import { socialHandlers } from "../_lib/social-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => socialHandlers().blocksList(request);
export const POST = (request: Request) => socialHandlers().blockCreate(request);
