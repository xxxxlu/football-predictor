import { overviewHandlers } from "../overview/runtime";
export const runtime = "nodejs";
// One audit endpoint, now filterable (Story 11.4). The unfiltered request is
// simply the default query, so there is no second trail to keep in step.
export const GET = (request: Request) => overviewHandlers().audit(request);
