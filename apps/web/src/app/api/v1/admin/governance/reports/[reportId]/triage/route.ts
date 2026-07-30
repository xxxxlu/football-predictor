import { governanceHandlers } from "../../../runtime";
export const runtime = "nodejs";
export const PATCH = (request: Request, context: { params: Promise<{ reportId: string }> }) =>
  context.params.then(({ reportId }) => governanceHandlers().triage(request, reportId));
