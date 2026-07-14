import { operationsHandlers } from "../../_lib/operations-runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return operationsHandlers().accountHistory(request);
}
