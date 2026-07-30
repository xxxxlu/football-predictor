import { governanceHandlers } from "../../runtime";
export const runtime = "nodejs";
export const GET = (request: Request, context: { params: Promise<{ reportId: string }> }) =>
  context.params.then(({ reportId }) => governanceHandlers().detail(request, reportId));
