import { privacyHandlers } from "../../_lib/privacy-runtime";

export const runtime = "nodejs";

export const GET = (request: Request) => privacyHandlers().consentList(request);
export const POST = (request: Request) => privacyHandlers().consentUpdate(request);