import { governanceHandlers } from "../runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => governanceHandlers().list(request);
