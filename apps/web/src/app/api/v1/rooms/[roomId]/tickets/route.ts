import { getIdentityService } from "../../../auth/_lib/runtime";
import { createTicketPost } from "./handler";
import { getTicketSubmissionService } from "./runtime";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  return createTicketPost(getIdentityService(), getTicketSubmissionService())(request, (await context.params).roomId);
}
