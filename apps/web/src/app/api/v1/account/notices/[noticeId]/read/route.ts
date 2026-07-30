import { governanceNoticeHandlers } from "../../../../admin/governance/notice-runtime";
export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ noticeId: string }> }) =>
  context.params.then(({ noticeId }) => governanceNoticeHandlers().markRead(request, noticeId));
