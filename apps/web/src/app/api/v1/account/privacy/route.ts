import { socialHandlers } from "../../_lib/social-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => socialHandlers().privacyGet(request);
export const PATCH = (request: Request) => socialHandlers().privacyPatch(request);
