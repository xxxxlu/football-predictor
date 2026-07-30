import { userSecurityHandlers } from "./runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => userSecurityHandlers().list(request);
