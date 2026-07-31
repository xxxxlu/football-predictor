import { socialHandlers } from "../../_lib/social-runtime";
export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
  return socialHandlers().friendRemove(request, (await context.params).userId);
}
