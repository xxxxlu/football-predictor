import { overviewHandlers } from "./runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => overviewHandlers().overview(request);
