import { privacyHandlers } from "../../_lib/privacy-runtime";

export const runtime = "nodejs";

export const DELETE = (request: Request) => privacyHandlers().dataDelete(request);
