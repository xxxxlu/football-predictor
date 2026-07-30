import { userSecurityHandlers } from "../users/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => userSecurityHandlers().listAnonymizationRequests(request);
