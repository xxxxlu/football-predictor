import { userSecurityHandlers } from "../../runtime";

export const runtime = "nodejs";

/** Ends every live session of one account. Sign-in stays possible; this is not a disable. */
export const DELETE = async (request: Request, context: { params: Promise<{ userId: string }> }) =>
  userSecurityHandlers().revokeSessions(request, (await context.params).userId);
