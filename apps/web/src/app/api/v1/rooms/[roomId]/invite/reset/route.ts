import { roomHandlers } from "../../../_lib/routes";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) { return roomHandlers().resetInvite(request, (await context.params).roomId); }
