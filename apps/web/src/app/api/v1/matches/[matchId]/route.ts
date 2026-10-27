import { getMatchApiRuntime } from "../runtime";
import { createMatchGet, type RouteContext } from "./handler";

export const GET = (request: Request, context: RouteContext) => {
  const runtime = getMatchApiRuntime();
  return createMatchGet(runtime.cache, runtime.access)(request, context);
};
