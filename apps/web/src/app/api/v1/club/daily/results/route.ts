import { clubHandlers } from "../../../_lib/club-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => clubHandlers().resultsGet(request);
