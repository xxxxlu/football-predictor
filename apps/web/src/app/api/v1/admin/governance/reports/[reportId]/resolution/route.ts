import { governanceHandlers } from "../../../runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ reportId: string }> }) =>
  context.params.then(({ reportId }) => governanceHandlers().resolve(request, reportId));
