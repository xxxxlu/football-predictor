import { userSecurityHandlers } from "../../runtime";
export const runtime = "nodejs";
export const DELETE = async (request: Request, context: { params: Promise<{ userId: string }> }) =>
  userSecurityHandlers().removeAvatar(request, (await context.params).userId);
