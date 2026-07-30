import { overviewHandlers } from "../../../overview/runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ jobId: string }> }) =>
  context.params.then(({ jobId }) => overviewHandlers().retryJob(request, jobId));
