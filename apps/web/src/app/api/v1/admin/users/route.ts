import { getIdentityService } from "../../auth/_lib/runtime";
import { createAdminIdentityHandlers } from "./handlers";
export const runtime = "nodejs";
export const GET = (request: Request) => createAdminIdentityHandlers(getIdentityService()).list(request);
