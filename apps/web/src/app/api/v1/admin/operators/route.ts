import { getIdentityService } from "../../auth/_lib/runtime";
import { createOperatorRoleHandlers } from "./handlers";
export const runtime = "nodejs";
export const GET = (request: Request) => createOperatorRoleHandlers(getIdentityService()).list(request);
