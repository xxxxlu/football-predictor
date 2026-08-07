import { privacyHandlers } from "../../../../_lib/privacy-runtime";

export const runtime = "nodejs";

export const GET = async (request: Request, context: { params: Promise<{ userId: string }> }) =>
  privacyHandlers().adminUserData(request, (await context.params).userId);