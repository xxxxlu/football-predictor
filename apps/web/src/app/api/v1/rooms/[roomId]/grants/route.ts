import { grantHandlers } from "../../_lib/grants-runtime";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) { return grantHandlers().list(request, (await context.params).roomId); }
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) { return grantHandlers().request(request, (await context.params).roomId); }
