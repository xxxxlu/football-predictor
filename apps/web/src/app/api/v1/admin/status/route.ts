import { operationsHandlers } from "../../_lib/operations-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => operationsHandlers().adminStatus(request);
