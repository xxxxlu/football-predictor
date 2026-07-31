import { socialHandlers } from "../../../_lib/social-runtime";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return socialHandlers().requestRespond(request, (await context.params).requestId);
}
