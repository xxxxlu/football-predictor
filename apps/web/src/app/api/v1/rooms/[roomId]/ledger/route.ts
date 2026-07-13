import { operationsHandlers } from "../../../_lib/operations-runtime";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) { return operationsHandlers().ledger(request, (await context.params).roomId); }
