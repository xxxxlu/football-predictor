import { roomHandlers } from "../../_lib/routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) { return roomHandlers().balance(request, (await context.params).roomId); }
