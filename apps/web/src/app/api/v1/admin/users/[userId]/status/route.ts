import { getIdentityService } from "../../../../auth/_lib/runtime";
import { createAdminIdentityHandlers } from "../../handlers";
export const runtime = "nodejs";
export const PATCH = async (request: Request, context: { params: Promise<{ userId: string }> }) => createAdminIdentityHandlers(getIdentityService()).setStatus(request, (await context.params).userId);
