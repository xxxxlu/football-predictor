import { overviewHandlers } from "../overview/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => overviewHandlers().failedJobs(request);
