import { getAuthHandlers } from "../_lib/routes";
export const runtime = "nodejs";
export const GET = (request: Request) => getAuthHandlers().session(request);
