import { privacyHandlers } from "../../_lib/privacy-runtime";

export const runtime = "nodejs";

export const POST = (request: Request) => privacyHandlers().locationSubmit(request);