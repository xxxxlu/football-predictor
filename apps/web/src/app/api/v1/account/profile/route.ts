import { operationsHandlers } from "../../_lib/operations-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => operationsHandlers().profileGet(request);
export const PATCH = (request: Request) => operationsHandlers().profilePatch(request);
