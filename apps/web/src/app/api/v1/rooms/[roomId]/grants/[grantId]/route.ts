import { grantHandlers } from "../../../_lib/grants-runtime";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ roomId: string; grantId: string }> }) {
  const { roomId, grantId } = await context.params;
  return grantHandlers().decide(request, roomId, grantId);
}
