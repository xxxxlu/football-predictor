import { getMatchApiRuntime } from "./runtime";
import { createMatchesGet } from "./handler";

export const GET = (request: Request) => {
  const runtime = getMatchApiRuntime();
  return createMatchesGet(runtime.cache, runtime.access)(request);
};
