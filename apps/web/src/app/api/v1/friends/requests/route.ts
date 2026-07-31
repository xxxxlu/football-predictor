import { socialHandlers } from "../../_lib/social-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => socialHandlers().requestsList(request);
export const POST = (request: Request) => socialHandlers().requestCreate(request);
