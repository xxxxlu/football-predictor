import { getAuthHandlers } from "../_lib/routes";
export const runtime = "nodejs";
export const POST = (request: Request) => getAuthHandlers().changePassword(request);
