import { roomHandlers } from "../../_lib/routes";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return roomHandlers().joinPublic(request, (await context.params).roomId);
}
