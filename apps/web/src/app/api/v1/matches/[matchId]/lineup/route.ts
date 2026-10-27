import { getMatchApiRuntime } from "../../runtime";
import { createLineupGet, type RouteContext } from "./handler";

export const GET = (request: Request, context: RouteContext) => {
  const runtime = getMatchApiRuntime();
  return createLineupGet(runtime.lineup, runtime.access)(request, context);
};
