import { userSecurityHandlers } from "../../runtime";
export const runtime = "nodejs";
export const PATCH = async (request: Request, context: { params: Promise<{ userId: string }> }) => userSecurityHandlers().setStatus(request, (await context.params).userId);
