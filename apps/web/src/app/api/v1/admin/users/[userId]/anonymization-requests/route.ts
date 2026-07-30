import { userSecurityHandlers } from "../../runtime";

export const runtime = "nodejs";

/** Records an anonymization request received out of band, starting the NFR22 seven-day clock. */
export const POST = async (request: Request, context: { params: Promise<{ userId: string }> }) =>
  userSecurityHandlers().fileAnonymizationRequest(request, (await context.params).userId);
