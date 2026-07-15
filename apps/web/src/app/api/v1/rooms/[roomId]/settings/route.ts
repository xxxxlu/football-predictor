import { roomHandlers } from "../../_lib/routes";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return roomHandlers().updateSettings(request, (await context.params).roomId);
}
