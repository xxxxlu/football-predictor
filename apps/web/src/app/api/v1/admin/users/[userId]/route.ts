import { userSecurityHandlers } from "../runtime";

export const runtime = "nodejs";

export const GET = async (request: Request, context: { params: Promise<{ userId: string }> }) =>
  userSecurityHandlers().detail(request, (await context.params).userId);
