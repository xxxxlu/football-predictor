import { userSecurityHandlers } from "../../../../runtime";

export const runtime = "nodejs";

/** Completes an open request through the shared anonymization routine (FR70). Never a hard delete. */
export const POST = async (request: Request, context: { params: Promise<{ userId: string; requestId: string }> }) => {
  const { userId, requestId } = await context.params;
  return userSecurityHandlers().completeAnonymizationRequest(request, userId, requestId);
};
