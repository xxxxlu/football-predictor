import { governanceNoticeHandlers } from "../../admin/governance/notice-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => governanceNoticeHandlers().list(request);
