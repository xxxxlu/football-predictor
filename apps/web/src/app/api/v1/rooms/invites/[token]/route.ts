import { roomHandlers } from "../../_lib/routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) { return roomHandlers().previewInvite(request, (await context.params).token); }
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) { return roomHandlers().join(request, (await context.params).token); }
