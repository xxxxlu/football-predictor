import { getIdentityService } from "../../auth/_lib/runtime";
import { createAdminIdentityHandlers } from "../users/handlers";

export const runtime = "nodejs";
export const GET = (request: Request) => createAdminIdentityHandlers(getIdentityService()).audience(request);
